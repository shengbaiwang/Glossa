import { pushInput, ackInput } from '@glossa/sync-contracts/sync';
import { push } from './sync/push';
import { trimLog, expireTrash } from './sync/retention';
import { ack, pull, snapshot } from './sync/pull';
import { groupScope } from './sync/entities';
import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import {
  ApiError,
  confirmUploadInput,
  createUploadInput,
  negotiateChunksInput,
  negotiateAssetsInput,
  manifestPartInput,
  manifestInput,
  streamInput,
  type Bindings,
  exchangeInput,
  id,
  refreshInput,
  type AppEnv,
} from './contracts';
import { authenticate, exchange, listDevices, revoke, rotate } from './auth/sessions';

import { confirm } from './storage/confirm';

import { createUpload, negotiate, sessionGuard, uploadStatus } from './storage/uploads';
import { putPart, publish } from './storage/manifest';
import { getManifest, stream } from './storage/read';
import { purgeBook } from './library/purge';
import { isGuardFailure } from './db/batch';
import { sweep } from './storage/gc';

const app = new Hono<AppEnv>();
function failure(c: Context<AppEnv>, e: ApiError) {
  return c.json(
    { error: { code: e.code, retryable: e.status === 503 }, request_id: c.get('requestId') },
    e.status,
  );
}
async function input<T>(c: Context<AppEnv>, schema: z.ZodType<T>) {
  if (c.req.header('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json')
    throw new ApiError(415, 'json_required');
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new ApiError(400, 'invalid_json');
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(422, 'invalid_request');
  return parsed.data;
}
app.use('*', async (c, next) => {
  c.set('requestId', crypto.randomUUID());
  c.header('Cache-Control', 'no-store');
  await next();
});
app.use(
  '/v1/*',
  cors({
    origin: (origin, c) =>
      (c.env.CLIENT_ORIGINS as string | undefined)
        ?.split(',')
        .map((s) => s.trim())
        .includes(origin)
        ? origin
        : null,
    allowHeaders: ['Authorization', 'Content-Type'],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    maxAge: 600,
  }),
);
app.use(
  '/v1/*',
  bodyLimit({
    maxSize: 256 * 1024,
    onError: (c) => failure(c, new ApiError(413, 'body_too_large')),
  }),
);
app.onError((error, c) => {
  if (error instanceof ApiError) return failure(c, error);
  console.error('control_plane_error', c.get('requestId'), error.name);
  return failure(c, new ApiError(503, 'service_unavailable'));
});
app.notFound((c) => failure(c, new ApiError(404, 'not_found')));
app.post('/v1/auth/exchange', async (c) =>
  c.json(await exchange(c.env, await input(c, exchangeInput))),
);
app.post('/v1/auth/refresh', async (c) =>
  c.json(await rotate(c.env, (await input(c, refreshInput)).refresh_token)),
);

const protectedRoutes = new Hono<AppEnv>();
protectedRoutes.use('*', async (c, next) => {
  c.set('principal', await authenticate(c.env, c.req.header('authorization')));
  await next();
});
function uuid(raw: string) {
  const parsed = id.safeParse(raw);
  if (!parsed.success) throw new ApiError(422, 'invalid_id');
  return parsed.data;
}
const uint = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,15})$/)
  .transform(Number)
  .pipe(z.int().nonnegative());
protectedRoutes.post('/sync/push', async (c) =>
  c.json(await push(c.env, c.get('principal'), (await input(c, pushInput)).ops)),
);
protectedRoutes.post('/sync/ack', async (c) =>
  c.json(await ack(c.env, c.get('principal'), (await input(c, ackInput)).cursor)),
);
protectedRoutes.get('/sync/pull', async (c) => {
  const q = z
    .strictObject({
      after: uint,
      limit: uint.pipe(z.number().min(1).max(128)).optional(),
      until: uint.optional(),
    })
    .safeParse(c.req.query());
  if (!q.success) throw new ApiError(422, 'invalid_cursor');
  return c.json(
    await pull(c.env, c.get('principal'), q.data.after, q.data.limit ?? 64, q.data.until),
  );
});
protectedRoutes.get('/sync/snapshot', async (c) => {
  const q = z
    .strictObject({ page_token: z.string().max(2048).optional() })
    .safeParse(c.req.query());
  if (!q.success) throw new ApiError(422, 'invalid_cursor');
  return c.json(await snapshot(c.env, c.get('principal'), q.data.page_token));
});
protectedRoutes.post('/groups/:id/removal-preview', async (c) => {
  const { include_books } = await input(c, z.strictObject({ include_books: z.boolean() }));
  const id = uuid(c.req.param('id'));
  const scope = await groupScope(c.env.DB, c.get('principal').user, id, include_books);
  if (!scope) throw new ApiError(404, 'group_not_found');
  if ('large' in scope) throw new ApiError(413, 'scope_too_large');
  return c.json({
    scope_digest: scope.scope_digest,
    group_count: scope.groups.length,
    book_count: scope.books.length,
    rev: scope.groups.find((g) => g.id === id)!.rev,
  });
});
protectedRoutes.get('/sync/trash-policy', async (c) => {
  const days = await c.env.DB.prepare('SELECT days FROM trash_policy WHERE user_id=?')
    .bind(c.get('principal').user)
    .first<number>('days');
  return c.json({ days });
});
protectedRoutes.put('/sync/trash-policy', async (c) => {
  const { days } = await input(c, z.strictObject({ days: z.int().min(1).max(3650).nullable() }));
  const principal = c.get('principal');
  const db = c.env.DB;
  const update =
    days === null
      ? db.prepare('DELETE FROM trash_policy WHERE user_id=?').bind(principal.user)
      : db
          .prepare(
            'INSERT INTO trash_policy VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET days=excluded.days',
          )
          .bind(principal.user, days);
  try {
    await db.batch([sessionGuard(c.env, principal), update]);
  } catch (error) {
    if (isGuardFailure(error)) throw new ApiError(401, 'session_revoked');
    throw error;
  }
  return c.json({ days });
});
protectedRoutes.post('/books/:id/purge', async (c) => {
  const body = await input(
    c,
    z.strictObject({ op_id: id, expected_trash_rev: z.int().nonnegative() }),
  );
  return c.json(
    await purgeBook(
      c.env,
      c.get('principal'),
      uuid(c.req.param('id')),
      body.op_id,
      body.expected_trash_rev,
    ),
  );
});
protectedRoutes.post('/books/:id/uploads', async (c) => {
  const data = await input(c, createUploadInput);
  return c.json(
    await createUpload(
      c.env,
      c.get('principal'),
      uuid(c.req.param('id')),
      data.op_id,
      data.base_manifest_id,
    ),
    201,
  );
});
protectedRoutes.get('/books/:id/uploads/:upload', async (c) =>
  c.json(
    await uploadStatus(
      c.env,
      c.get('principal'),
      uuid(c.req.param('id')),
      uuid(c.req.param('upload')),
    ),
  ),
);
protectedRoutes.post('/storage/chunks/negotiate', async (c) => {
  const data = await input(c, negotiateChunksInput);
  return c.json(await negotiate(c.env, c.get('principal'), data.upload_id, data.chunks));
});
protectedRoutes.post('/storage/assets/negotiate', async (c) => {
  const data = await input(c, negotiateAssetsInput);
  return c.json(await negotiate(c.env, c.get('principal'), data.upload_id, data.assets));
});
protectedRoutes.put('/books/:id/uploads/:upload/parts/:part', async (c) => {
  const part = z
    .string()
    .regex(/^(0|[1-9][0-9]{0,9})$/)
    .safeParse(c.req.param('part'));
  if (!part.success) throw new ApiError(422, 'invalid_part');
  return c.json(
    await putPart(
      c.env,
      c.get('principal'),
      uuid(c.req.param('id')),
      uuid(c.req.param('upload')),
      Number(part.data),
      await input(c, manifestPartInput),
    ),
  );
});
protectedRoutes.put('/books/:id/manifest', async (c) =>
  c.json(
    await publish(
      c.env,
      c.get('principal'),
      uuid(c.req.param('id')),
      await input(c, manifestInput),
    ),
  ),
);
const page = z.strictObject({
  manifest_id: id.optional(),
  after_ordinal: z
    .string()
    .regex(/^\d{1,10}$/)
    .optional(),
  limit: z
    .string()
    .regex(/^[1-9]\d{0,2}$/)
    .transform(Number)
    .pipe(z.number().max(128))
    .optional(),
});
protectedRoutes.get('/books/:id/manifest', async (c) => {
  const query = page.safeParse(c.req.query());
  if (!query.success) throw new ApiError(422, 'invalid_page');
  return c.json(
    await getManifest(
      c.env,
      c.get('principal'),
      uuid(c.req.param('id')),
      query.data.manifest_id,
      Number(query.data.after_ordinal ?? -1),
      query.data.limit ?? 128,
    ),
  );
});
protectedRoutes.post('/books/:id/stream-urls', async (c) =>
  c.json(
    await stream(c.env, c.get('principal'), uuid(c.req.param('id')), await input(c, streamInput)),
  ),
);
protectedRoutes.post('/storage/uploads/:session_id/confirm', async (c) => {
  const upload = id.safeParse(c.req.param('session_id'));
  if (!upload.success) throw new ApiError(422, 'invalid_upload_id');
  const { object_ids } = await input(c, confirmUploadInput);
  return c.json(await confirm(c.env, c.get('principal'), upload.data, object_ids));
});
protectedRoutes.get('/devices', async (c) =>
  c.json({ devices: await listDevices(c.env, c.get('principal')) }),
);
protectedRoutes.delete('/devices/:id', async (c) => {
  const target = id.safeParse(c.req.param('id'));
  if (!target.success) throw new ApiError(422, 'invalid_device_id');
  await revoke(c.env, c.get('principal'), target.data);
  return c.body(null, 204);
});
protectedRoutes.delete('/sessions/current', async (c) => {
  await revoke(c.env, c.get('principal'));
  return c.body(null, 204);
});
app.route('/v1', protectedRoutes);
export default {
  fetch: app.fetch,
  scheduled: async (event: ScheduledController, env: Bindings) => {
    switch (event.cron) {
      case '*/10 * * * *':
        await sweep(env);
        break;
      case '3 * * * *':
        await trimLog(env);
        break;
      case '6 * * * *':
        await expireTrash(env);
        break;
    }
  },
};
