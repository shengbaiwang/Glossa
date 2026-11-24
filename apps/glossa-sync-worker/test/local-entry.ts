import { trimLog, expireTrash } from '../src/sync/retention';
import { sweep } from '../src/storage/gc';
// Only the ephemeral integration configuration loads this entry point.
import worker from '../src/index';
import { authenticate } from '../src/auth/sessions';
import { chunkedBatch, guard, isGuardFailure, statement } from '../src/db/batch';
import { confirmUploadInput, type Bindings } from '../src/contracts';

async function exerciseDB(db: D1Database) {
  const rows = Array.from({ length: 214 }, (_, i) => ['row' + i, i]);
  await db.prepare('CREATE TABLE batch_fixture (name TEXT PRIMARY KEY, n INTEGER NOT NULL)').run();
  const inserts = chunkedBatch(
    db,
    rows,
    [],
    (row) => row,
    (slots) =>
      'INSERT INTO batch_fixture(name,n) VALUES ' + slots.map((slot) => '(' + slot + ')').join(','),
  );
  let aborted = false;
  try {
    await db.batch([...inserts, guard(db, '0')]);
  } catch (error) {
    if (!isGuardFailure(error)) throw error;
    aborted = true;
  }
  const afterRollback = await db.prepare('SELECT count(*) FROM batch_fixture').first('count(*)');
  await db.batch(inserts);
  const reads = chunkedBatch(
    db,
    rows,
    [0],
    (row) => [row[0]!],
    (slots) => 'SELECT n FROM batch_fixture WHERE n>=? AND name IN (' + slots.join(',') + ')',
  );
  const found = (await db.batch(reads)).flatMap((result) => result.results);
  const user = crypto.randomUUID();
  await db.batch([
    statement(db, "INSERT INTO users VALUES(?,'test','db',0)", user),
    statement(
      db,
      "INSERT INTO devices(user_id,id,name,created_at) VALUES(?,'D','fixture',0)",
      user,
    ),
    statement(
      db,
      "INSERT INTO books(user_id,id,file_hash,title,format,rev) VALUES(?,'B',?,'fixture','pdf',1)",
      user,
      'a'.repeat(64),
    ),
    statement(
      db,
      "INSERT INTO uploads(user_id,id,book_id,device_id,expires_at,state) VALUES(?,'M','B','D',1,'sealed')",
      user,
    ),
    statement(
      db,
      "INSERT INTO objects(user_id,id,object_key,kind,blake3,bytes,md5_b64,mime,state) VALUES(?,'K','key','chunk',?,1,'digest','application/octet-stream','ready')",
      user,
      'b'.repeat(64),
    ),
    statement(db, "INSERT INTO manifest_chunks VALUES(?,'M',0,'K',0,0)", user),
  ]);
  const publish = statement(
    db,
    "INSERT INTO current_manifests VALUES(?,'B','M',1,1,'v1','digest',1)",
    user,
  );
  let unverifiedRejected = false;
  try {
    await publish.run();
  } catch (error) {
    if (!String(error).includes('manifest_object_unverified')) throw error;
    unverifiedRejected = true;
  }
  await db.batch([
    statement(
      db,
      "INSERT INTO upload_objects(user_id,upload_id,object_id,verified_at) VALUES(?,'M','K',1)",
      user,
    ),
    publish,
  ]);
  let updateRejected = false;
  try {
    await db.batch([
      statement(db, 'UPDATE upload_objects SET verified_at=NULL WHERE user_id=?', user),
      statement(db, 'UPDATE current_manifests SET rev=2 WHERE user_id=?', user),
    ]);
  } catch (error) {
    if (!String(error).includes('manifest_object_unverified')) throw error;
    updateRejected = true;
  }
  let foreignKeyRejected = false;
  try {
    await statement(
      db,
      "INSERT INTO upload_objects(user_id,upload_id,object_id,verified_at) VALUES(?,'M','K',1)",
      crypto.randomUUID(),
    ).run();
  } catch (error) {
    if (!String(error).includes('FOREIGN KEY')) throw error;
    foreignKeyRejected = true;
  }
  const ids = Array.from({ length: 26 }, () => crypto.randomUUID());
  return {
    aborted,
    afterRollback,
    inserts: inserts.length,
    reads: reads.length,
    found: found.length,
    unverifiedRejected,
    updateRejected,
    foreignKeyRejected,
    accepts25: confirmUploadInput.safeParse({ object_ids: ids.slice(0, 25) }).success,
    accepts26: confirmUploadInput.safeParse({ object_ids: ids }).success,
  };
}

type LocalEnv = Bindings & { OBJECTS: R2Bucket };
async function seedUpload(env: LocalEnv, req: Request) {
  const p = await authenticate(env, req.headers.get('authorization') ?? undefined);
  const upload = crypto.randomUUID();
  const book = crypto.randomUUID();
  const statements = [
    statement(
      env.DB,
      "INSERT INTO books(user_id,id,file_hash,title,format,rev) VALUES(?,?,?,'fixture','pdf',1)",
      p.user,
      book,
      'c'.repeat(64),
    ),
    statement(
      env.DB,
      "INSERT INTO uploads(user_id,id,book_id,device_id,expires_at,state) VALUES(?,?,?,?,?,'open')",
      p.user,
      upload,
      book,
      p.device,
      Date.now() + 60000,
    ),
  ];
  const objectIds = [];
  for (let i = 0; i < 25; i++) {
    const id = crypto.randomUUID();
    const body = new TextEncoder().encode('chunk-' + i);
    const md5 = await crypto.subtle.digest('MD5', body);
    const md5b64 = btoa(String.fromCharCode(...new Uint8Array(md5)));
    statements.push(
      statement(
        env.DB,
        "INSERT INTO objects(user_id,id,object_key,kind,blake3,bytes,md5_b64,mime,state) VALUES(?,?,?,'chunk',?,?,?,'application/octet-stream','reserved')",
        p.user,
        id,
        id,
        i.toString(16).padStart(64, '0'),
        body.length,
        md5b64,
      ),
    );
    statements.push(
      statement(
        env.DB,
        'INSERT INTO upload_objects(user_id,upload_id,object_id) VALUES(?,?,?)',
        p.user,
        upload,
        id,
      ),
    );
    if (i < 24)
      await env.OBJECTS.put(id, body, {
        md5,
        httpMetadata: { contentType: 'application/octet-stream' },
      });
    objectIds.push(id);
  }
  await env.DB.batch(statements);
  return { upload, objectIds };
}

export default {
  async fetch(req: Request, env: LocalEnv) {
    if (new URL(req.url).pathname === '/__db-fixture')
      return Response.json(await exerciseDB(env.DB));
    if (new URL(req.url).pathname === '/__upload-fixture')
      return Response.json(await seedUpload(env, req));
    const path = new URL(req.url).pathname;
    if (path === '/__maintenance-fixture') {
      const data = await req.json<{ advance: number; job: 'log' | 'trash' }>();
      const now = Date.now() + data.advance;
      if (data.job === 'log') await trimLog(env, now);
      else await expireTrash(env, now);
      return Response.json({ ok: true });
    }
    if (path === '/__sweep-fixture') {
      const data = await req.json<{ advance: number }>();
      await sweep(env, Date.now() + data.advance);
      return Response.json({ ok: true });
    }
    // Miniflare has a bucket binding, but does not expose the R2 S3 endpoint.
    // The Node harness verifies SigV4 independently before sending bytes to this fixture.
    if (path.startsWith('/__bucket/')) {
      const key = path.slice('/__bucket/'.length);
      if (req.method === 'PUT') {
        const md5 = Uint8Array.from(atob(req.headers.get('content-md5')!), (c) => c.charCodeAt(0));
        const result = await env.OBJECTS.put(key, req.body, {
          md5,
          httpMetadata: { contentType: req.headers.get('content-type')! },
          onlyIf: { etagDoesNotMatch: '*' },
        });
        return new Response(null, { status: result ? 200 : 412 });
      }
      const object = await env.OBJECTS.get(key);
      return new Response(object?.body ?? null, { status: object ? 200 : 404 });
    }
    let heads = 0;
    const res = await worker.fetch(req, {
      ...env,
      OBJECTS: {
        delete: (key) => env.OBJECTS.delete(key),
        head: (key: string) => {
          heads++;
          return env.OBJECTS.head(key);
        },
      },
    });
    const copy = new Response(res.body, res);
    copy.headers.set('x-fixture-heads', String(heads));
    return copy;
  },
};
