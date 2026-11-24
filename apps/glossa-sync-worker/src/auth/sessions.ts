import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import type { z } from 'zod';
import {
  ApiError,
  unauthorized,
  type Bindings,
  type Principal,
  type exchangeInput,
} from '../contracts';
import { guard, isGuardFailure, statement } from '../db/batch';
import { devices } from '../db/schema';
import { digestJti, identity, issuePair, SESSION_SECONDS, verifyToken } from './tokens';

// Embed only this fixed SQL. The identity is bound anew in each prepared statement.
const account = '(SELECT id FROM users WHERE issuer=? AND subject=?)';
export const liveSession = `SELECT 1 FROM sessions s JOIN devices d
  ON d.user_id=s.user_id AND d.id=s.device_id
  WHERE s.user_id=? AND s.id=? AND s.device_id=? AND s.expires_at>?
    AND s.revoked_at IS NULL AND d.revoked_at IS NULL`;

export async function exchange(env: Bindings, input: z.infer<typeof exchangeInput>) {
  const { issuer, subject } = await identity(env, input.identity_token);
  const db = env.DB;
  const now = Date.now();
  const expires = now + SESSION_SECONDS * 1000;
  const session = crypto.randomUUID();
  const refresh = crypto.randomUUID();
  const digest = await digestJti(env, refresh);
  const device = input.device_id;
  try {
    const results = await db.batch<{ id: string }>([
      statement(
        db,
        'INSERT INTO users(id,issuer,subject,created_at) VALUES(?,?,?,?) ON CONFLICT(issuer,subject) DO NOTHING',
        crypto.randomUUID(),
        issuer,
        subject,
        now,
      ),
      statement(
        db,
        `INSERT INTO devices(user_id,id,name,created_at,last_seen_at)
        VALUES(${account},?,?,?,?) ON CONFLICT(user_id,id) DO UPDATE
        SET name=excluded.name,last_seen_at=excluded.last_seen_at WHERE devices.revoked_at IS NULL`,
        issuer,
        subject,
        device,
        input.device_name,
        now,
        now,
      ),
      guard(db, 'changes()=1'),
      statement(
        db,
        `INSERT INTO sync_state(user_id) VALUES(${account}) ON CONFLICT(user_id) DO NOTHING`,
        issuer,
        subject,
      ),
      statement(
        db,
        `INSERT INTO sessions(user_id,id,device_id,expires_at) VALUES(${account},?,?,?)`,
        issuer,
        subject,
        session,
        device,
        expires,
      ),
      statement(
        db,
        `INSERT INTO refresh_tokens(user_id,jti_digest,session_id,expires_at) VALUES(${account},?,?,?)`,
        issuer,
        subject,
        digest,
        session,
        expires,
      ),
      statement(db, 'SELECT id FROM users WHERE issuer=? AND subject=?', issuer, subject),
    ]);
    const user = results[6]!.results[0]!.id;
    return issuePair(env, { user, device, session }, expires, refresh);
  } catch (error) {
    if (isGuardFailure(error)) throw new ApiError(403, 'device_revoked');
    throw error;
  }
}

export async function rotate(env: Bindings, token: string) {
  const p = await verifyToken(env, token, 'refresh');
  const db = env.DB;
  const refresh = crypto.randomUUID();
  const [oldDigest, newDigest] = await Promise.all([
    digestJti(env, p.jti),
    digestJti(env, refresh),
  ]);
  const now = Date.now();
  const result = await db.batch([
    // This write must commit on a replay even though the HTTP result is 401.
    statement(
      db,
      `UPDATE sessions SET revoked_at=? WHERE user_id=? AND id=? AND device_id=?
      AND revoked_at IS NULL AND EXISTS(SELECT 1 FROM refresh_tokens
      WHERE user_id=? AND session_id=? AND jti_digest=? AND used_at IS NOT NULL)`,
      now,
      p.user,
      p.session,
      p.device,
      p.user,
      p.session,
      oldDigest,
    ),
    statement(
      db,
      `UPDATE refresh_tokens SET used_at=? WHERE user_id=? AND session_id=? AND jti_digest=?
      AND used_at IS NULL AND expires_at>? AND EXISTS(${liveSession})`,
      now,
      p.user,
      p.session,
      oldDigest,
      now,
      p.user,
      p.session,
      p.device,
      now,
    ),
    statement(
      db,
      `INSERT INTO refresh_tokens(user_id,jti_digest,session_id,expires_at)
      SELECT ?,?,?,? WHERE changes()=1`,
      p.user,
      newDigest,
      p.session,
      p.expiresAt,
    ),
    statement(
      db,
      'UPDATE devices SET last_seen_at=? WHERE user_id=? AND id=? AND changes()=1',
      now,
      p.user,
      p.device,
    ),
  ]);
  if (result[2]!.meta.changes !== 1) throw unauthorized();
  return issuePair(env, p, p.expiresAt, refresh);
}

export async function authenticate(env: Bindings, bearer?: string): Promise<Principal> {
  const token = /^Bearer ([^\s]+)$/i.exec(bearer ?? '')?.[1];
  if (!token || token.length > 16_384) throw unauthorized();
  const p = await verifyToken(env, token, 'access');
  if (!(await statement(env.DB, liveSession, p.user, p.session, p.device, Date.now()).first()))
    throw unauthorized();
  return p;
}

export function listDevices(env: Bindings, p: Principal) {
  return drizzle(env.DB)
    .select({
      id: devices.id,
      name: devices.name,
      last_seen_at: devices.lastSeenAt,
      revoked_at: devices.revokedAt,
    })
    .from(devices)
    .where(eq(devices.userId, p.user))
    .orderBy(devices.id)
    .all();
}

export async function revoke(env: Bindings, p: Principal, target?: string) {
  const db = env.DB;
  const now = Date.now();
  const statements = [guard(db, `EXISTS(${liveSession})`, p.user, p.session, p.device, now)];
  if (target) {
    statements.push(
      statement(
        db,
        'UPDATE devices SET revoked_at=COALESCE(revoked_at,?) WHERE user_id=? AND id=?',
        now,
        p.user,
        target,
      ),
    );
    statements.push(
      statement(
        db,
        'UPDATE sessions SET revoked_at=? WHERE user_id=? AND device_id=? AND revoked_at IS NULL',
        now,
        p.user,
        target,
      ),
    );
  } else {
    statements.push(
      statement(
        db,
        'UPDATE sessions SET revoked_at=? WHERE user_id=? AND id=?',
        now,
        p.user,
        p.session,
      ),
    );
  }
  try {
    const result = await db.batch(statements);
    if (target && !result[1]!.meta.changes) throw new ApiError(404, 'device_not_found');
  } catch (error) {
    if (isGuardFailure(error)) throw unauthorized();
    throw error;
  }
}
