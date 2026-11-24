import { SignJWT, createLocalJWKSet, createRemoteJWKSet, jwtVerify, errors, base64url } from 'jose';
import { z } from 'zod';
import { ApiError, id, unauthorized, type Bindings, type Principal } from '../contracts';

const encoder = new TextEncoder();
export const ACCESS_SECONDS = 600;
export const SESSION_SECONDS = 30 * 24 * 3600;
type TokenUse = 'access' | 'refresh';

function secret(env: Bindings, name: 'ACCESS_SECRET' | 'REFRESH_SECRET' | 'JTI_SECRET') {
  const keys = [env.ACCESS_SECRET, env.REFRESH_SECRET, env.JTI_SECRET];
  if (
    !env.TOKEN_ISSUER ||
    keys.some((k) => !k || encoder.encode(k).length < 32) ||
    new Set(keys).size !== 3
  )
    throw new Error('Invalid Worker token configuration');
  return encoder.encode(env[name]);
}

let remote: { url: string; resolver: ReturnType<typeof createRemoteJWKSet> } | undefined;
function identityKeys(env: Bindings) {
  if (
    !env.IDENTITY_ISSUER ||
    !env.IDENTITY_AUDIENCE ||
    Boolean(env.IDENTITY_JWKS_JSON) === Boolean(env.IDENTITY_JWKS_URL)
  )
    throw new Error('Invalid identity configuration');
  if (env.IDENTITY_JWKS_JSON) return createLocalJWKSet(JSON.parse(env.IDENTITY_JWKS_JSON));
  const url = new URL(env.IDENTITY_JWKS_URL!);
  if (url.protocol !== 'https:') throw new Error('Identity JWKS requires HTTPS');
  if (remote?.url !== url.href) remote = { url: url.href, resolver: createRemoteJWKSet(url) };
  return remote.resolver;
}

function verificationError(error: unknown): never {
  if (error instanceof errors.JWKSTimeout) throw new ApiError(503, 'identity_unavailable');
  if (error instanceof errors.JOSEError) throw unauthorized();
  throw error;
}

export async function identity(env: Bindings, token: string) {
  const keys = identityKeys(env);
  try {
    const { payload } = await jwtVerify(token, keys, {
      issuer: env.IDENTITY_ISSUER,
      audience: env.IDENTITY_AUDIENCE,
      algorithms: ['ES256', 'RS256'],
      requiredClaims: ['exp', 'sub', 'iat'],
    });
    if (!payload.sub || payload.sub.length > 512) throw unauthorized();
    return { issuer: env.IDENTITY_ISSUER, subject: payload.sub };
  } catch (error) {
    verificationError(error);
  }
}

export async function digestJti(env: Bindings, jti: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    secret(env, 'JTI_SECRET'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return base64url.encode(
    new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(jti))),
  );
}

const claims = z.object({ sub: id, sid: id, did: id, jti: id });
export async function verifyToken(env: Bindings, token: string, use: TokenUse) {
  const key = secret(env, use === 'access' ? 'ACCESS_SECRET' : 'REFRESH_SECRET');
  try {
    const { payload } = await jwtVerify(token, key, {
      issuer: env.TOKEN_ISSUER,
      audience: 'glossa:' + use,
      algorithms: ['HS256'],
      requiredClaims: ['exp', 'iat', 'jti'],
    });
    const parsed = claims.safeParse(payload);
    if (payload.token_use !== use || !parsed.success) throw unauthorized();
    const { sub: user, sid: session, did: device, jti } = parsed.data;
    return { user, session, device, jti, expiresAt: payload.exp! * 1000 };
  } catch (error) {
    verificationError(error);
  }
}

export async function issuePair(
  env: Bindings,
  p: Principal,
  expiresAt: number,
  refreshJti: string,
) {
  const now = Math.floor(Date.now() / 1000);
  const deadline = Math.floor(expiresAt / 1000);
  if (deadline <= now) throw unauthorized();
  const lifetime = Math.min(ACCESS_SECONDS, deadline - now);
  const sign = (use: TokenUse, jti: string, exp: number) =>
    new SignJWT({ sid: p.session, did: p.device, token_use: use })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuer(env.TOKEN_ISSUER)
      .setAudience('glossa:' + use)
      .setSubject(p.user)
      .setJti(jti)
      .setIssuedAt(now)
      .setExpirationTime(exp)
      .sign(secret(env, use === 'access' ? 'ACCESS_SECRET' : 'REFRESH_SECRET'));
  const [access_token, refresh_token] = await Promise.all([
    sign('access', crypto.randomUUID(), now + lifetime),
    sign('refresh', refreshJti, deadline),
  ]);
  return {
    access_token,
    refresh_token,
    expires_in: lifetime,
    device_id: p.device,
    session_id: p.session,
  };
}
