import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes, randomUUID, createHmac, createHash } from 'node:crypto';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'node:net';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';

import { DatabaseSync } from 'node:sqlite';
import { SqliteReplica, httpTransport } from '@glossa/sync-contracts/replica';
import { publishFile, prepareFile, uploadTransport } from '@glossa/sync-contracts/publisher';
import { CloudRangeReader, readerTransport } from '@glossa/sync-contracts/reader';
import { chunkFile, describeObject } from '@glossa/sync-contracts/chunker';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = join(root, 'node_modules/wrangler/bin/wrangler.js');
const issuer = 'https://identity.example.test/auth/v1';
const audience = 'glossa-local';

test('Wrangler local D1 control plane', { timeout: 360_000 }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'glossa-m1-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { publicKey, privateKey } = await generateKeyPair('ES256');
  const vars = {
    CLIENT_ORIGINS: 'https://reader.local.test',
    IDENTITY_ISSUER: issuer,
    IDENTITY_AUDIENCE: audience,
    IDENTITY_JWKS_JSON: JSON.stringify({
      keys: [{ ...(await exportJWK(publicKey)), kid: 'local', alg: 'ES256' }],
    }),
    R2_S3_ENDPOINT: 'https://s3.local.example',
    R2_BUCKET_NAME: 'local-objects',
    R2_ACCESS_KEY_ID: 'fixture',
    R2_SECRET_ACCESS_KEY: randomBytes(32).toString('hex'),
    TOKEN_ISSUER: 'https://sync.example.test',
  };
  for (const key of ['ACCESS_SECRET', 'REFRESH_SECRET', 'JTI_SECRET'])
    vars[key] = randomBytes(48).toString('base64url');
  const configPath = join(dir, 'wrangler.json');
  const config = JSON.parse(await readFile(join(root, 'wrangler.jsonc'), 'utf8'));
  config.main = join(root, 'test/local-entry.ts');
  config.d1_databases[0].migrations_dir = join(root, 'drizzle');
  await writeFile(configPath, JSON.stringify(config));
  await writeFile(
    join(dir, '.dev.vars'),
    Object.entries(vars)
      .map(([key, v]) => key + "='" + v + "'")
      .join('\n'),
    { mode: 0o600 },
  );
  const ddl = (
    await Promise.all(
      JSON.parse(await readFile(join(root, 'drizzle/meta/_journal.json'), 'utf8')).entries.map(({ tag }) =>
        readFile(join(root, 'drizzle', tag + '.sql'), 'utf8'),
      ),
    )
  ).join('\n');
  assert.equal(
    ddl,
    await readFile(resolve(root, '../../docs/design/local-first-cloud-v1.sql'), 'utf8'),
  );
  const opts = {
    cwd: root,
    env: {
      ...process.env,
      WRANGLER_SEND_METRICS: 'false',
      WRANGLER_LOG_PATH: join(dir, 'wrangler.log'),
    },
  };
  const flags = ['--config', configPath, '--local', '--persist-to', join(dir, 'state')];
  const migrate = () =>
    promisify(execFile)(process.execPath, [cli, 'd1', 'migrations', 'apply', 'DB', ...flags], opts);
  await migrate();
  await migrate();
  const listener = createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const { port } = listener.address();
  await new Promise((resolve) => listener.close(resolve));
  const proc = spawn(
    process.execPath,
    [
      cli,
      'dev',
      ...flags,
      '--ip',
      '127.0.0.1',
      '--port',
      String(port),
      '--inspector-port',
      '0',
      '--show-interactive-dev-session=false',
    ],
    { ...opts, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let logs = '';
  for (const stream of [proc.stdout, proc.stderr])
    stream.on('data', (data) => {
      logs = (logs + data).slice(-4000);
    });
  try {
    const base = 'http://127.0.0.1:' + port;
    async function api(path, { method = 'GET', body, token } = {}) {
      try {
        return await fetch(base + path, {
          method,
          headers: {
            Connection: 'close',
            ...(token && { Authorization: 'Bearer ' + token }),
            ...(body && { 'Content-Type': 'application/json' }),
          },
          body: body && JSON.stringify(body),
        });
      } catch (error) {
        throw new Error('Local HTTP ' + method + ' ' + path + ' failed: ' + error.cause?.code, {
          cause: error,
        });
      }
    }
    let ready = false;
    for (let i = 0; i < 150; i++) {
      if (proc.exitCode !== null) break;
      try {
        if ((await api('/v1/devices')).status === 401) {
          ready = true;
          break;
        }
      } catch {}
      await delay(150);
    }
    // Wrangler may print values of dev variables. Keep diagnostic output free of secrets.
    if (!ready)
      throw Error(
        'Local Worker did not start: ' +
          logs
            .split('\n')
            .filter((line) => /ERROR|Error:/.test(line))
            .slice(-3)
            .join(' '),
      );
    async function identity(subject, aud = audience) {
      return new SignJWT({})
        .setProtectedHeader({ alg: 'ES256', kid: 'local' })
        .setSubject(subject)
        .setIssuer(issuer)
        .setAudience(aud)
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(privateKey);
    }
    async function login(token, device_id = randomUUID()) {
      const res = await api('/v1/auth/exchange', {
        method: 'POST',
        body: { identity_token: token, device_id, device_name: 'Local fixture' },
      });
      return res;
    }
    const refresh = (refresh_token) =>
      api('/v1/auth/refresh', { method: 'POST', body: { refresh_token } });
    const list = (token) => api('/v1/devices', { token });
    async function direct(method, address, headers = {}, body) {
      const url = new URL(address);
      const sig = url.searchParams.get('X-Amz-Signature');
      url.searchParams.delete('X-Amz-Signature');
      const encode = (s) =>
        encodeURIComponent(s).replace(
          /[!'()*]/g,
          (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
        );
      const query = [...url.searchParams]
        .map(([k, v]) => [encode(k), encode(v)].join('='))
        .sort()
        .join('&');
      const names = url.searchParams.get('X-Amz-SignedHeaders');
      assert.equal(
        names,
        method === 'PUT' ? 'content-md5;content-type;host;if-none-match' : 'host',
      );
      const h = new Headers(headers);
      h.set('host', url.host);
      const canonical = [
        method,
        url.pathname,
        query,
        names
          .split(';')
          .map((n) => n + ':' + h.get(n) + '\n')
          .join(''),
        names,
        'UNSIGNED-PAYLOAD',
      ].join('\n');
      const [, day, region, service, term] = url.searchParams.get('X-Amz-Credential').split('/');
      const stamp = url.searchParams.get('X-Amz-Date');
      const digest = (s) => createHash('sha256').update(s).digest('hex');
      const mac = (k, s) => createHmac('sha256', k).update(s).digest();
      const key = [day, region, service, term].reduce(mac, 'AWS4' + vars.R2_SECRET_ACCESS_KEY);
      assert.equal(
        sig,
        mac(
          key,
          [
            'AWS4-HMAC-SHA256',
            stamp,
            [day, region, service, term].join('/'),
            digest(canonical),
          ].join('\n'),
        ).toString('hex'),
      );
      assert.equal(url.origin, vars.R2_S3_ENDPOINT);
      try {
        return await fetch(base + url.pathname.replace('/local-objects/', '/__bucket/'), {
          method,
          headers: { ...headers, Connection: 'close' },
          body,
        });
      } catch (error) {
        throw new Error(
          'Local R2 fixture ' +
            method +
            ' failed for ' +
            (body?.length ?? 0) +
            ' bytes: ' +
            error.cause?.code,
          { cause: error },
        );
      }
    }
    async function openDeviceReplica(session, user) {
      const disk = new DatabaseSync(join(dir, session.device_id + '.db'));
      const db = {
        async select(sql, args = []) {
          return disk.prepare(sql).all(...args);
        },
        async execute(sql, args = []) {
          return disk.prepare(sql).run(...args);
        },
        async batch(statements) {
          disk.exec('BEGIN');
          try {
            for (const sql of statements) disk.exec(sql);
            disk.exec('COMMIT');
          } catch (err) {
            disk.exec('ROLLBACK');
            throw err;
          }
        },
      };
      const replica = await SqliteReplica.open(db, {
        issuer: base,
        user,
        device: session.device_id,
      });
      return { replica, close: () => disk.close() };
    }
    async function createBook(token, file_hash, thumbhash = null) {
      const book = randomUUID();
      const create = {
        op_id: randomUUID(),
        entity_id: book,
        lamport: 1,
        kind: 'book.create',
        data: { title: 'Original fixture', format: 'pdf', file_hash, thumbhash },
      };
      // Fetch the latest account clock when the same test device creates another book.
      const clock = await (await api('/v1/sync/pull?after=0', { token })).json();
      if (clock.events?.length) create.lamport = clock.events.at(-1).lamport + 1;
      else if (clock.error?.code === 'cursor_expired') create.lamport = Date.now();
      const res = await api('/v1/sync/push', { token, method: 'POST', body: { ops: [create] } });
      const body = await res.json();
      assert.equal(body.results?.[0].status, 'applied', JSON.stringify(body));
      return { book };
    }
    await t.test('control plane preflight allows only configured client origins', async () => {
      for (const origin of ['https://reader.local.test', 'https://unregistered.local.test']) {
        const reply = await fetch(base + '/v1/sync/pull', {
          method: 'OPTIONS',
          headers: {
            Origin: origin,
            'Access-Control-Request-Method': 'GET',
            'Access-Control-Request-Headers': 'authorization',
          },
        });
        assert.equal(
          reply.headers.get('access-control-allow-origin'),
          origin.includes('unregistered') ? null : origin,
        );
      }
    });
    await t.test(
      'D1 binding budget, atomic guards, manifest verification and tenant keys',
      async () => {
        const result = await api('/__db-fixture');
        assert.equal(result.status, 200);
        assert.deepEqual(await result.json(), {
          aborted: true,
          afterRollback: 0,
          inserts: 5,
          reads: 3,
          found: 214,
          unverifiedRejected: true,
          updateRejected: true,
          foreignKeyRejected: true,
          accepts25: true,
          accepts26: false,
        });
      },
    );
    await t.test(
      'device sessions, tenant isolation, refresh rotation, replay and logout',
      async () => {
        const proof = await identity('reader');
        assert.equal((await login(await identity('reader', 'other'))).status, 401);
        assert.equal(
          (
            await api('/v1/auth/exchange', {
              method: 'POST',
              body: {
                identity_token: proof,
                device_id: randomUUID(),
                device_name: 'test',
                user_id: randomUUID(),
              },
            })
          ).status,
          422,
        );
        const sameAccount = await Promise.all([login(proof), login(proof)]);
        for (const res of sameAccount) assert.equal(res.status, 200);
        const [a, b] = await Promise.all(sameAccount.map((res) => res.json()));
        assert.equal((await (await list(a.access_token)).json()).devices.length, 2);
        assert.equal((await list(a.refresh_token)).status, 401);
        const other = await (await login(await identity('another'))).json();
        assert.equal(
          (await api('/v1/devices/' + b.device_id, { method: 'DELETE', token: other.access_token }))
            .status,
          404,
        );
        const rotated = await refresh(a.refresh_token);
        assert.equal(rotated.status, 200);
        const successor = await rotated.json();
        assert.equal((await list(successor.access_token)).status, 200);
        assert.equal((await refresh(a.refresh_token)).status, 401);
        assert.equal((await refresh(successor.refresh_token)).status, 401);
        assert.equal((await list(successor.access_token)).status, 401);
        assert.equal((await list(b.access_token)).status, 200);
        const current = await (await login(proof, b.device_id)).json();
        assert.equal(
          (await api('/v1/sessions/current', { method: 'DELETE', token: current.access_token }))
            .status,
          204,
        );
        assert.equal((await list(current.access_token)).status, 401);
        assert.equal(
          (await api('/v1/devices/' + b.device_id, { method: 'DELETE', token: b.access_token }))
            .status,
          204,
        );
        assert.equal((await list(b.access_token)).status, 401);
        assert.equal((await login(proof, b.device_id)).status, 403);
        assert.equal((await list(other.access_token)).status, 200);
      },
    );
    await t.test(
      '25-object confirmation calls local R2 only for authorized, unverified generations',
      async () => {
        const a = await (await login(await identity('upload-owner'))).json();
        const b = await (await login(await identity('another-reader'))).json();
        const { upload, objectIds } = await (
          await api('/__upload-fixture', { token: a.access_token })
        ).json();
        const confirm = (token, object_ids) =>
          api('/v1/storage/uploads/' + upload + '/confirm', {
            method: 'POST',
            token,
            body: { object_ids },
          });
        for (const [token, ids, status] of [
          [a.access_token, [...objectIds, randomUUID()], 422],
          [b.access_token, objectIds, 404],
          [a.access_token, [objectIds[0], randomUUID()], 404],
        ]) {
          const rejected = await confirm(token, ids);
          assert.equal(rejected.status, status);
          assert.equal(rejected.headers.get('x-fixture-heads'), '0');
        }
        const result = await confirm(a.access_token, objectIds);
        assert.equal(result.status, 200);
        assert.equal(result.headers.get('x-fixture-heads'), '25');
        assert.deepEqual(await result.json(), {
          verified: objectIds.slice(0, 24),
          pending: objectIds.slice(24),
        });
        const replay = await confirm(a.access_token, objectIds.slice(0, 24));
        assert.equal(replay.status, 200);
        assert.equal(replay.headers.get('x-fixture-heads'), '0');
        assert.deepEqual(await replay.json(), { verified: objectIds.slice(0, 24), pending: [] });
      },
    );
    await t.test(
      'reader publisher rejects changed bytes and reuses the confirmed chunk after interruption',
      async () => {
        const token = (await (await login(await identity('publisher'))).json()).access_token;
        const original = new Blob(['Glossa client publication fixture']);
        const plan = await prepareFile(original);
        const thumbhash = 'HAkOJwg3iIiIiIiIiIiIiIiIiIiIiIiI';
        const { book } = await createBook(token, plan.file_blake3, thumbhash);
        const control = uploadTransport(base, async () => token);
        let uploads = 0,
          losePart = true;
        const transport = {
          async control(path, method, body) {
            if (losePart && path.includes('/parts/')) {
              losePart = false;
              throw new Error('interrupted');
            }
            return control.control(path, method, body);
          },
          async put(url, headers, bytes) {
            uploads++;
            return direct('PUT', url, headers, bytes);
          },
        };
        await assert.rejects(
          publishFile(transport, book, new Blob(['changed']), plan),
          /source_file_changed/,
        );
        assert.equal(uploads, 0);
        const layout = {
          role: 'layout_manifest',
          mime: 'application/json',
          codec_version: 'epub-spine-ranges-v1',
          body: new Blob([JSON.stringify({ source_file_blake3: plan.file_blake3 })]),
        };
        const search = {
          role: 'search_sidecar',
          mime: 'application/gzip',
          codec_version: 'section-text-gzip-v1',
          body: await new Response(layout.body.stream().pipeThrough(new CompressionStream('gzip'))).blob(),
        };
        const preview = {
          role: 'head_preview_chunk', mime: 'application/json', codec_version: 'glossa-head-preview-v1',
          body: new Blob([JSON.stringify({ source_file_blake3: plan.file_blake3, file_bytes: original.size, format: 'epub', text: 'Opening chapter' })]),
        };
        const coverBytes = await readFile(join(root, 'test/fixtures/cover.avif'));
        const cover = {
          role: 'cover_avif',
          mime: 'image/avif',
          codec_version: 'avif-v1',
          body: new Blob([coverBytes]),
        };
        const assets = [layout, search, preview, cover];
        await assert.rejects(publishFile(transport, book, original, plan, assets), /interrupted/);
        const pointer = await publishFile(transport, book, original, plan, assets);
        assert.equal(uploads, 5); // One original and four distinct assets across both sessions.
        const peer = await (await login(await identity('publisher'))).json();
        const second = await openDeviceReplica(peer, 'publisher');
        let discovered;
        try {
          await second.replica.synchronize(httpTransport(base, async () => peer.access_token));
          const catalog = await second.replica.publishedBooks();
          assert.equal(catalog.books.length, 1);
          const [row] = catalog.books;
          assert.equal(row.thumbhash, thumbhash);
          const manifest = await (await api('/v1/books/' + book + '/manifest', { token: peer.access_token })).json();
          const coverAsset = manifest.assets.find((asset) => asset.role === 'cover_avif');
          assert.ok(coverAsset.object_key);
          assert.equal(row.cover_avif_key, coverAsset.object_key);
          discovered = {book_id:row.id, manifest_id:row.manifest_id, file_blake3:row.file_hash};
          assert.deepEqual([catalog.books[0].id, catalog.books[0].file_hash, catalog.books[0].manifest_id,
            catalog.books[0].file_bytes, catalog.books[0].title], [book,plan.file_blake3,pointer.manifest_id,original.size,'Original fixture']);
        } finally { second.close(); }
        const reader = await CloudRangeReader.open(
          {
            ...readerTransport(base, async () => peer.access_token),
            object: (url) => direct('GET', url),
          },
          discovered,
        );
        try {
          assert.deepEqual(Buffer.from(await reader.asset('cover_avif')), coverBytes);
          assert.equal(reader.assets.find((a) => a.role === layout.role).codec_version, layout.codec_version);
          assert.equal(reader.assets.find((a) => a.role === search.role).codec_version, search.codec_version);
          assert.equal(new TextDecoder().decode(await reader.asset(preview.role)), await preview.body.text());
          const compressed = new Blob([await reader.asset(search.role)]);
          assert.equal(await new Response(compressed.stream().pipeThrough(new DecompressionStream('gzip'))).text(), await layout.body.text());
          assert.equal(new TextDecoder().decode(await reader.asset(layout.role)), await layout.body.text());
          assert.equal(
            new TextDecoder().decode(await reader.read(0, original.size)),
            await original.text(),
          );
        } finally {
          reader.close();
        }
      },
    );
    await t.test('negotiate, direct object transfer, publish, deduplicate and seek', async () => {
      const token = (await (await login(await identity('storage'))).json()).access_token;
      const post = (path, body, method = 'POST') => api('/v1' + path, { method, token, body });
      const ok = async (res) => {
        const json = await res.json();
        assert.ok(res.ok, JSON.stringify(json));
        return json;
      };
      const sample = Buffer.from('Glossa original fixture');
      const [chunk, file] = await Array.fromAsync(
        chunkFile(
          (async function* () {
            yield sample;
          })(),
        ),
      );
      const { blake3, md5_b64, bytes } = chunk;
      const { book } = await createBook(token, file.file_blake3);
      const open = { op_id: randomUUID(), base_manifest_id: null };
      const { upload_id } = await ok(await post('/books/' + book + '/uploads', open));
      assert.equal(
        (await ok(await post('/books/' + book + '/uploads', open))).upload_id,
        upload_id,
      );
      const negotiate = () =>
        post('/storage/chunks/negotiate', {
          upload_id,
          chunks: [
            { blake3, md5_b64, bytes },
            { blake3, md5_b64, bytes },
          ],
        });
      const first = await ok(await negotiate());
      assert.equal(first.missing.length, 1);
      const put = first.missing[0];
      assert.equal((await direct('PUT', put.put_url, put.headers, sample)).status, 200);
      const layout = Buffer.from(
        JSON.stringify({ source_file_blake3: blake3, pages: [{ ranges: [[0, bytes - 1]] }] }),
      );
      const [ld] = await Array.fromAsync(
        chunkFile(
          (async function* () {
            yield layout;
          })(),
        ),
      );
      const asset = await ok(
        await post('/storage/assets/negotiate', {
          upload_id,
          assets: [
            {
              role: 'layout_manifest',
              codec_version: 'layout-v1',
              mime: 'application/json',
              blake3: ld.blake3,
              md5_b64: ld.md5_b64,
              bytes: layout.length,
            },
          ],
        }),
      );
      const invalidCover = await post('/storage/assets/negotiate', {
        upload_id,
        assets: [{ ...describeObject(layout), role: 'cover_avif', codec_version: 'v1', mime: 'application/json' }],
      });
      assert.equal(invalidCover.status, 422);
      const side = asset.missing[0];
      await direct('PUT', side.put_url, side.headers, layout);
      // Preparation can yield more objects than the final immutable manifest selects.
      const extra = Buffer.from('discarded layout draft');
      const descriptor = describeObject(extra);
      const extraLease = await ok(await post('/storage/chunks/negotiate', {
        upload_id, chunks: [descriptor],
      }));
      const unused = extraLease.missing[0];
      assert.equal((await direct('PUT', unused.put_url, unused.headers, extra)).status, 200);
      await ok(await post('/storage/uploads/' + upload_id + '/confirm', {
        object_ids: [unused.object_id],
      }));
      const manifest = {
        op_id: randomUUID(),
        upload_id,
        base_manifest_id: null,
        file_blake3: file.file_blake3,
        file_bytes: bytes,
        chunker: 'fastcdc-glossa-v1',
        chunk_count: 1,
        chunks: [{ ordinal: 0, blake3, start_byte: 0, end_byte: bytes - 1 }],
        assets: [
          { role: 'layout_manifest', object_id: side.object_id, codec_version: 'layout-v1' },
        ],
      };
      const commit = () => post('/books/' + book + '/manifest', manifest, 'PUT');
      assert.equal((await commit()).status, 409);
      await ok(
        await post('/storage/uploads/' + upload_id + '/confirm', {
          object_ids: [put.object_id, side.object_id],
        }),
      );
      assert.equal((await ok(await negotiate())).present[0].object_id, put.object_id);
      // A failed inline publish must release the proposed layout so the same session can recover.
      const invalidBase = {
        ...manifest,
        base_manifest_id: randomUUID(),
        file_bytes: bytes * 2,
        chunk_count: 2,
        chunks: [
          ...manifest.chunks,
          { ordinal: 1, blake3, start_byte: bytes, end_byte: bytes * 2 - 1 },
        ],
      };
      assert.equal((await post('/books/' + book + '/manifest', invalidBase, 'PUT')).status, 409);
      const res = await commit();
      assert.equal(res.headers.get('x-fixture-heads'), '0');
      const published = await ok(res);
      assert.deepEqual(await ok(await commit()), published);
      const page = await ok(await api('/v1/books/' + book + '/manifest', { token }));
      assert.equal(page.manifest_digest, published.manifest_digest);
      assert.ok(Number.isSafeInteger(page.book_rev) && page.book_rev > 0);
      assert.equal(page.status, 'unread');
      assert.equal(page.finished_at, null);
      const stream = await ok(
        await post('/books/' + book + '/stream-urls', {
          manifest_id: upload_id,
          ranges: [{ start_byte: 2, end_byte: 4 }],
          assets: ['layout_manifest'],
        }),
      );
      assert.deepEqual(
        Buffer.from(await (await direct('GET', stream.chunks[0].get_url)).arrayBuffer()),
        sample,
      );
      assert.deepEqual(
        Buffer.from(await (await direct('GET', stream.assets[0].get_url)).arrayBuffer()),
        layout,
      );
      // Exercise the scheduled collector while the book and current manifest stay live.
      await ok(await api('/__sweep-fixture', { method: 'POST', body: { advance: 600000 } }));
      const nextUpload = await ok(await post('/books/' + book + '/uploads', {
        op_id: randomUUID(), base_manifest_id: upload_id,
      }));
      const reacquired = await ok(await post('/storage/chunks/negotiate', {
        upload_id: nextUpload.upload_id, chunks: [descriptor, { blake3, bytes, md5_b64 }],
      }));
      assert.deepEqual(reacquired.present.map((item) => item.object_id), [put.object_id]);
      assert.equal(reacquired.missing.length, 1);
      assert.equal(reacquired.missing[0].blake3, descriptor.blake3);
      assert.notEqual(reacquired.missing[0].object_id, unused.object_id);
      const pointer = { book_id: book, manifest_id: upload_id, file_blake3: file.file_blake3 };
      let reads = 0,
        damage = true;
      const reader = await CloudRangeReader.open(
        {
          ...readerTransport(base, async () => token),
          async object(url) {
            reads++;
            if (damage) return new Response(new Uint8Array(bytes));
            return direct('GET', url);
          },
        },
        pointer,
      );
      await assert.rejects(reader.read(0, 1), /object_hash_mismatch/);
      damage = false;
      assert.deepEqual(Buffer.from(await reader.read(2, 5)), sample.subarray(2, 5));
      assert.deepEqual(Buffer.from(await reader.read(3, 4)), sample.subarray(3, 4));
      assert.equal(reads, 2);
      assert.deepEqual(Buffer.from(await reader.asset('layout_manifest')), layout);
      reader.close();
      await assert.rejects(reader.read(0, 1), { name: 'AbortError' });
      const status = await ok(await api('/v1/books/' + book + '/uploads/' + upload_id, { token }));
      assert.equal(status.state, 'committed');
      assert.deepEqual(status.result, published);
      const purge = { op_id: randomUUID(), expected_trash_rev: published.server_seq };
      assert.equal((await post('/books/' + book + '/purge', purge)).status, 409);
      const trashEvent = await ok(
        await post('/sync/push', {
          ops: [
            {
              op_id: randomUUID(),
              entity_id: book,
              kind: 'book.trash',
              lamport: 10,
              base_rev: published.server_seq,
            },
          ],
        }),
      );
      assert.equal(trashEvent.results[0].status, 'applied');
      const trash = { rev: trashEvent.results[0].entity_rev };
      await ok(await api('/__sweep-fixture', { method: 'POST', body: { advance: 8 * 86400000 } }));
      assert.equal((await direct('GET', stream.chunks[0].get_url)).status, 200);
      assert.equal(
        (
          await post('/books/' + book + '/stream-urls', {
            manifest_id: upload_id,
            ranges: [{ start_byte: 0, end_byte: 0 }],
            assets: [],
          })
        ).status,
        410,
      );
      purge.expected_trash_rev = trash.rev;
      const purged = await ok(await post('/books/' + book + '/purge', purge));
      assert.deepEqual(await ok(await post('/books/' + book + '/purge', purge)), purged);
      await ok(await api('/__sweep-fixture', { method: 'POST', body: { advance: 0 } }));
      assert.equal((await direct('GET', stream.chunks[0].get_url)).status, 200);
      await ok(await api('/__sweep-fixture', { method: 'POST', body: { advance: 600000 } }));
      assert.equal((await direct('GET', stream.chunks[0].get_url)).status, 404);
      const replacement = await createBook(token, file.file_blake3);
      const next = await ok(
        await post('/books/' + replacement.book + '/uploads', {
          op_id: randomUUID(),
          base_manifest_id: null,
        }),
      );
      const fresh = await ok(
        await post('/storage/chunks/negotiate', {
          upload_id: next.upload_id,
          chunks: [{ blake3, md5_b64, bytes }],
        }),
      );
      assert.notEqual(fresh.missing[0].object_id, put.object_id);
    });
    await t.test('shared covers survive one book purge and identical files have tenant-local deduplication', async () => {
      const cover = {
        role: 'cover_avif',
        mime: 'image/avif',
        codec_version: 'avif-v1',
        body: new Blob([await readFile(join(root, 'test/fixtures/cover.avif'))]),
      };
      async function publish(token, text) {
        const file = new Blob([text]);
        const plan = await prepareFile(file);
        const { book } = await createBook(token, plan.file_blake3);
        let puts = 0;
        const transport = {
          ...uploadTransport(base, async () => token),
          async put(url, headers, bytes) {
            puts++;
            return direct('PUT', url, headers, bytes);
          },
        };
        const pointer = await publishFile(transport, book, file, plan, [cover]);
        return { pointer, puts };
      }
      const alice = (await (await login(await identity('shared-alice'))).json()).access_token;
      const bob = (await (await login(await identity('shared-bob'))).json()).access_token;
      const first = await publish(alice, 'First edition');
      const revised = await publish(alice, 'Second edition');
      const other = await publish(bob, 'First edition');
      assert.deepEqual([first.puts, revised.puts, other.puts], [2, 1, 2]);

      const path = '/v1/books/' + first.pointer.book_id;
      const header = await (await api(path + '/manifest', { token: alice })).json();
      const foreignRead = await api(path + '/stream-urls', {
        method: 'POST', token: bob,
        body: { manifest_id: first.pointer.manifest_id, ranges: [], assets: ['cover_avif'] },
      });
      assert.equal(foreignRead.status, 404);
      const trashed = await api('/v1/sync/push', {
        method: 'POST', token: alice,
        body: { ops: [{ op_id: randomUUID(), entity_id: first.pointer.book_id,
          lamport: Date.now(), kind: 'book.trash', base_rev: header.book_rev }] },
      });
      const [receipt] = (await trashed.json()).results;
      assert.equal(receipt.status, 'applied');
      assert.equal((await api(path + '/purge', {
        method: 'POST', token: alice,
        body: { op_id: randomUUID(), expected_trash_rev: receipt.entity_rev },
      })).status, 200);
      assert.equal((await api('/__sweep-fixture', {
        method: 'POST', body: { advance: 600000 },
      })).status, 200);
      const expectedCover = Buffer.from(await cover.body.arrayBuffer());
      for (const [token, { pointer }, text] of [
        [alice, revised, 'Second edition'], [bob, other, 'First edition'],
      ]) {
        const reader = await CloudRangeReader.open({
          ...readerTransport(base, async () => token),
          object: (url) => direct('GET', url),
        }, pointer);
        try {
          assert.deepEqual(Buffer.from(await reader.asset('cover_avif')), expectedCover);
          assert.equal(Buffer.from(await reader.read(0, reader.size)).toString(), text);
        } finally {
          reader.close();
        }
      }
    });
    await t.test(
      '257 distinct uploads span eleven confirmations and three manifest parts',
      async () => {
        const { access_token: token } = await (await login(await identity('many-chunks'))).json();
        const data = Array.from({ length: 257 }, (_, i) => Buffer.from([i >>> 8, i & 255]));
        const whole = describeObject(Buffer.concat(data));
        const { book } = await createBook(token, whole.blake3);
        const call = async (path, body, method = 'POST') => {
          const r = await api('/v1' + path, { token, body, method });
          const result = await r.json();
          assert.ok(r.ok, JSON.stringify(result));
          return { result, heads: Number(r.headers.get('x-fixture-heads')) };
        };
        const path = '/books/' + book;
        const {
          result: { upload_id },
        } = await call(path + '/uploads', { op_id: randomUUID(), base_manifest_id: null });
        const descriptors = data.map(describeObject);
        const bytesByHash = new Map(descriptors.map((d, i) => [d.blake3, data[i]]));
        const objectIds = [];
        for (let i = 0; i < data.length; i += 128) {
          const {
            result: { missing },
          } = await call('/storage/chunks/negotiate', {
            upload_id,
            chunks: descriptors.slice(i, i + 128),
          });
          assert.equal(missing.length, Math.min(128, data.length - i));
          for (let j = 0; j < missing.length; j += 4) {
            await Promise.all(
              missing.slice(j, j + 4).map(async (m) => {
                assert.equal(
                  (await direct('PUT', m.put_url, m.headers, bytesByHash.get(m.blake3))).status,
                  200,
                );
              }),
            );
          }
          objectIds.push(...missing.map((m) => m.object_id));
        }
        for (let i = 0; i < objectIds.length; i += 25) {
          const object_ids = objectIds.slice(i, i + 25);
          const confirmed = await call('/storage/uploads/' + upload_id + '/confirm', {
            object_ids,
          });
          assert.equal(confirmed.heads, object_ids.length);
          assert.deepEqual(confirmed.result.verified, object_ids);
        }
        for (let i = 0; i < data.length; i += 128) {
          const part = {
            first_ordinal: i,
            chunks: descriptors.slice(i, i + 128).map((d, j) => ({
              blake3: d.blake3,
              start_byte: (i + j) * 2,
              end_byte: (i + j) * 2 + 1,
            })),
          };
          await call(path + '/uploads/' + upload_id + '/parts/' + i / 128, part, 'PUT');
        }
        const published = await call(
          path + '/manifest',
          {
            op_id: randomUUID(),
            upload_id,
            base_manifest_id: null,
            file_blake3: whole.blake3,
            file_bytes: whole.bytes,
            chunker: 'fastcdc-glossa-v1',
            chunk_count: data.length,
            parts_complete: true,
            assets: [],
          },
          'PUT',
        );
        assert.equal(published.heads, 0);
        const { result: read } = await call(path + '/stream-urls', {
          manifest_id: upload_id,
          ranges: [{ start_byte: 255, end_byte: 258 }],
          assets: [],
        });
        assert.deepEqual(
          read.chunks.map((c) => c.ordinal),
          [127, 128, 129],
        );
      },
    );
    await t.test(
      '500 MiB stream: unique uploads, two-device deduplication and byte-exact reassembly',
      async () => {
        const proof = await identity('large-book');
        const a = await (await login(proof)).json(),
          b = await (await login(proof)).json();
        const ok = async (res) => {
          const body = await res.json();
          assert.ok(res.ok, JSON.stringify(body));
          return body;
        };
        const call = (session, path, body, method = 'POST') =>
          api('/v1' + path, { token: session.access_token, method, body });
        const block = Buffer.alloc(1024 * 1024);
        let seed = 0x13579bdf;
        for (let i = 0; i < block.length; i++) {
          seed ^= seed << 13;
          seed ^= seed >>> 17;
          seed ^= seed << 5;
          block[i] = seed & 255;
        }
        const unique = new Map(),
          chunks = [],
          sourceDigest = createHash('sha256');
        async function* source() {
          for (let i = 0; i < 500; i++) {
            sourceDigest.update(block);
            yield block;
            await new Promise((resolve) => setImmediate(resolve));
          }
        }
        let file;
        for await (const item of chunkFile(source())) {
          if (item.type === 'complete') {
            file = item;
            continue;
          }
          const { type, data, ordinal, start_byte, end_byte, ...descriptor } = item;
          unique.set(item.blake3, { data, descriptor });
          chunks.push({ ordinal, start_byte, end_byte, blake3: item.blake3 });
        }
        assert.equal(file.file_bytes, 500 * 1024 * 1024);
        assert.ok(unique.size < chunks.length);
        const { book } = await createBook(a.access_token, file.file_blake3);
        const open = async (session, base_manifest_id) =>
          ok(
            await call(session, '/books/' + book + '/uploads', {
              op_id: randomUUID(),
              base_manifest_id,
            }),
          );
        const { upload_id } = await open(a, null);
        const descriptors = [...unique.values()].map((o) => o.descriptor);
        const neg = await ok(
          await call(a, '/storage/chunks/negotiate', { upload_id, chunks: descriptors }),
        );
        assert.equal(neg.missing.length, unique.size);
        for (const object of neg.missing)
          assert.equal(
            (await direct('PUT', object.put_url, object.headers, unique.get(object.blake3).data))
              .status,
            200,
          );
        for (let i = 0; i < neg.missing.length; i += 25)
          await ok(
            await call(a, '/storage/uploads/' + upload_id + '/confirm', {
              object_ids: neg.missing.slice(i, i + 25).map((o) => o.object_id),
            }),
          );
        for (let i = 0; i < chunks.length; i += 128) {
          const path = '/books/' + book + '/uploads/' + upload_id + '/parts/' + i / 128;
          const part = {
            first_ordinal: i,
            chunks: chunks.slice(i, i + 128).map(({ ordinal, ...c }) => c),
          };
          assert.deepEqual(
            await ok(await call(a, path, part, 'PUT')),
            await ok(await call(a, path, part, 'PUT')),
          );
        }
        const manifest = {
          op_id: randomUUID(),
          upload_id,
          base_manifest_id: null,
          file_blake3: file.file_blake3,
          file_bytes: file.file_bytes,
          chunker: 'fastcdc-glossa-v1',
          chunk_count: chunks.length,
          parts_complete: true,
          assets: [],
        };
        const res = await call(a, '/books/' + book + '/manifest', manifest, 'PUT');
        assert.equal(res.headers.get('x-fixture-heads'), '0');
        await ok(res);
        const second = await open(b, upload_id);
        const dedup = await ok(
          await call(b, '/storage/chunks/negotiate', {
            upload_id: second.upload_id,
            chunks: descriptors,
          }),
        );
        assert.deepEqual(dedup.missing, []);
        assert.equal(dedup.present.length, unique.size);
        const downloaded = new Map(),
          recovered = createHash('sha256');
        for (let i = 0; i < chunks.length; i += 6) {
          const group = chunks.slice(i, i + 6);
          const urls = await ok(
            await call(b, '/books/' + book + '/stream-urls', {
              manifest_id: upload_id,
              assets: [],
              ranges: [{ start_byte: group[0].start_byte, end_byte: group.at(-1).end_byte }],
            }),
          );
          assert.deepEqual(
            urls.chunks.map((c) => c.ordinal),
            group.map((c) => c.ordinal),
          );
          for (const c of urls.chunks) {
            if (!downloaded.has(c.blake3)) {
              const response = await direct('GET', c.get_url);
              assert.equal(response.status, 200);
              const data = Buffer.from(await response.arrayBuffer());
              assert.deepEqual(data, Buffer.from(unique.get(c.blake3).data));
              downloaded.set(c.blake3, data);
            }
            recovered.update(downloaded.get(c.blake3));
          }
        }
        assert.equal(downloaded.size, unique.size);
        assert.equal(recovered.digest('hex'), sourceDigest.digest('hex'));
        t.diagnostic(
          '500 MiB: ' +
            chunks.length +
            ' ordered chunks, ' +
            unique.size +
            ' unique PUTs; device 2 required 0 PUTs.',
        );
      },
    );
    await t.test(
      'two offline devices converge on tree, reading epoch, annotation and trash state',
      async () => {
        const proof = await identity('sync'),
          a = await (await login(proof)).json(),
          b = await (await login(proof)).json();
        const op = (kind, entity_id, lamport, fields = {}) => ({
          kind,
          entity_id,
          op_id: randomUUID(),
          lamport,
          ...fields,
        });
        const path = (s, uri, body) =>
          api('/v1' + uri, { token: s.access_token, method: body ? 'POST' : 'GET', body });
        const push = async (s, ...ops) => {
          const r = await path(s, '/sync/push', { ops });
          const obj = await r.json();
          assert.equal(r.status, 200, JSON.stringify(obj));
          return obj.results;
        };
        const one = async (s, o) => (await push(s, o))[0];
        const xid = randomUUID(),
          yid = randomUUID(),
          book = randomUUID(),
          note = randomUUID();
        const g = (id, name, clock) =>
          op('group.create', id, clock, { data: { name, parent_id: null, sort_key: 'm' } });
        const X = g(xid, 'A', 1),
          Y = g(yid, 'B', 2);
        const [gx, gy] = await push(a, X, Y);
        assert.deepEqual(await one(a, X), gx);
        const changed = await path(a, '/sync/push', {
          ops: [{ ...X, data: { ...X.data, name: 'other' } }],
        });
        assert.equal(changed.status, 409);
        const move = (id, parent_id, rev, clock) =>
          op('group.move', id, clock, {
            base_placement_rev: rev,
            data: { parent_id, sort_key: 'n' },
          });
        assert.equal((await one(a, move(xid, yid, gx.entity_rev, 3))).status, 'applied');
        const cycle = await one(b, move(yid, xid, gy.entity_rev, 3));
        assert.equal(cycle.code, 'tree_cycle');
        assert.equal(cycle.parent_id, null);
        const made = await one(
          a,
          op('book.create', book, 4, {
            data: { title: 'Study', format: 'pdf', file_hash: 'b'.repeat(64), group_id: xid },
          }),
        );
        const pos = (clock, base, epoch, intent, bp) =>
          op('book.progress', book, clock, {
            epoch,
            base_position_rev: base,
            data: {
              intent,
              progress_bp: bp,
              anchor: { type: 'pdf', page_index: Math.floor(bp / 100) },
            },
          });
        const first = await one(a, pos(5, 0, 0, 'advance', 8000));
        const seek = await one(b, pos(5, first.entity_rev, 0, 'seek', 1000));
        assert.equal(seek.status, 'applied');
        assert.equal(
          (await one(a, pos(6, first.entity_rev, 0, 'advance', 9000))).code,
          'position_conflict',
        );
        const initial = await one(
          a,
          op('annotation.create', note, 7, {
            data: {
              book_id: book,
              kind: 'note',
              page_index: 0,
              cfi: null,
              rects: [],
              anchor_version: 1,
              text_fingerprint: null,
              note: 'first',
              style: {},
            },
          }),
        );
        const next = await one(
          b,
          op('annotation.patch', note, 8, {
            base_rev: initial.entity_rev,
            data: { note: 'second' },
          }),
        );
        assert.equal(
          (
            await one(
              a,
              op('annotation.patch', note, 8, {
                base_rev: initial.entity_rev,
                data: { note: 'offline draft' },
              }),
            )
          ).code,
          'revision_conflict',
        );
        assert.equal(next.status, 'applied');
        assert.equal(made.status, 'applied');
        const page = await (await path(b, '/sync/pull?after=0&limit=2')).json();
        assert.equal(page.events.length, 2);
        assert.equal((await path(b, '/sync/ack', { cursor: page.until })).status, 409);
        assert.equal((await path(b, '/sync/ack', { cursor: page.next_cursor })).status, 200);
        const records = [];
        let pageToken = null;
        do {
          const snap = await (
            await path(b, '/sync/snapshot' + (pageToken ? '?page_token=' + pageToken : ''))
          ).json();
          records.push(...snap.records);
          pageToken = snap.next_page_token;
        } while (pageToken);
        const saved = records.find((r) => r.id === book);
        assert.deepEqual(
          [saved.progress_bp, saved.furthest_bp, saved.position_epoch],
          [1000, 8000, 1],
        );
        assert.equal(records.find((r) => r.id === note).note, 'second');
        const preview = await (
          await path(a, '/groups/' + yid + '/removal-preview', { include_books: false })
        ).json();
        const dissolved = await one(
          a,
          op('group.dissolve', yid, 9, {
            base_rev: preview.rev,
            data: { include_books: false, scope_digest: preview.scope_digest },
          }),
        );
        assert.equal(dissolved.status, 'applied');
        const trash = await one(a, op('book.trash', book, 10, { base_rev: saved.rev }));
        assert.equal(
          (
            await one(
              b,
              op('annotation.patch', note, 11, {
                base_rev: next.entity_rev,
                data: { note: 'late' },
              }),
            )
          ).code,
          'book_unavailable',
        );
        assert.equal(
          (await one(a, op('book.restore', book, 12, { base_rev: trash.entity_rev }))).status,
          'applied',
        );
      },
    );
    await t.test(
      'disk SQLite devices recover lost receipts, conflicts and interrupted snapshots',
      async () => {
        const proof = await identity('replica');
        const a = await (await login(proof)).json();
        const b = await (await login(proof)).json();
        const transport = (session) => httpTransport(base, async () => session.access_token);
        const open = (session) => openDeviceReplica(session, 'replica');
        const book = randomUUID();
        const edit = (kind, fields) => ({ kind, op_id: randomUUID(), entity_id: book, ...fields });
        let first = await open(a),
          second = await open(b);
        try {
          const create = edit('book.create', {
            data: { title: 'Draft', format: 'pdf', file_hash: '9'.repeat(64) },
          });
          await first.replica.edit(create, create.data);
          await assert.rejects(
            first.replica.synchronize({
              async request(path, body) {
                const reply = await transport(a).request(path, body);
                if (path === '/sync/push') throw Error('lost response');
                return reply;
              },
            }),
            /lost response/,
          );
          first.close();
          first = await open(a);
          assert.equal((await first.replica.inspect('book', book)).drafts[0].state, 'pending');
          await first.replica.synchronize(transport(a));
          const initial = await first.replica.inspect('book', book);
          assert.equal(initial.confirmed.rev, 1);
          assert.deepEqual(initial.drafts, []);
          await second.replica.synchronize(transport(b));
          const patch = (title) => edit('book.patch', { base_rev: 1, data: { title } });
          await second.replica.edit(patch('Offline'), { title: 'Offline' });
          await first.replica.edit(patch('Winner'), { title: 'Winner' });
          await first.replica.synchronize(transport(a));
          await second.replica.synchronize(transport(b));
          second.close();
          second = await open(b);
          const conflict = await second.replica.inspect('book', book);
          assert.equal(conflict.confirmed.title, 'Winner');
          assert.equal(conflict.drafts[0].state, 'conflict');
          assert.equal(conflict.drafts[0].value.title, 'Offline');
          const trash = edit('book.trash', { base_rev: conflict.confirmed.rev });
          await first.replica.edit(trash, { deleted: true });
          await first.replica.synchronize(transport(a));
          const trashed = await first.replica.inspect('book', book);
          const purge = await api('/v1/books/' + book + '/purge', {
            token: a.access_token,
            method: 'POST',
            body: { op_id: randomUUID(), expected_trash_rev: trashed.confirmed.rev },
          });
          assert.equal(purge.status, 200);
          await assert.rejects(
            second.replica.synchronize({
              async request(path, body) {
                if (path.startsWith('/sync/snapshot?page_token'))
                  throw Error('interrupted snapshot');
                return transport(b).request(path, body);
              },
            }),
            /interrupted snapshot/,
          );
          second.close();
          second = await open(b);
          assert.deepEqual(await second.replica.inspect('book', book), conflict);
          await second.replica.synchronize(transport(b));
          const recovered = await second.replica.inspect('book', book);
          assert.equal(recovered.confirmed, null);
          assert.deepEqual(recovered.drafts, conflict.drafts);
        } finally {
          first.close();
          second.close();
        }
      },
    );
    await t.test(
      'trash retention is opt-in and an expired log cursor reboots through snapshot',
      async () => {
        const session = await (await login(await identity('retention'))).json();
        const token = session.access_token;
        const { book } = await createBook(token, '8'.repeat(64));
        const trash = await api('/v1/sync/push', {
          token,
          method: 'POST',
          body: {
            ops: [
              {
                op_id: randomUUID(),
                entity_id: book,
                kind: 'book.trash',
                base_rev: 1,
                lamport: 3,
              },
            ],
          },
        });
        assert.equal((await trash.json()).results[0].status, 'applied');
        const policy = '/v1/sync/trash-policy';
        const maintenance = async (job, days) => {
          const response = await api('/__maintenance-fixture', {
            method: 'POST',
            body: { job, advance: days * 86400000 },
          });
          assert.equal(response.status, 200, await response.text());
        };
        assert.deepEqual(await (await api(policy, { token })).json(), { days: null });
        await maintenance('trash', 2);
        assert.equal((await api('/v1/sync/pull?after=0', { token })).status, 200);
        assert.deepEqual(
          await (await api(policy, { token, method: 'PUT', body: { days: 1 } })).json(),
          { days: 1 },
        );
        await maintenance('trash', 2);
        assert.equal((await api('/v1/sync/pull?after=0', { token })).status, 410);
        const delta = await (await api('/v1/sync/pull?after=2', { token })).json();
        assert.equal(delta.events[0].changes[0].kind, 'book.purge');
        // The job processes at most four accounts at once, including earlier scenarios.
        for (let i = 0; i < 4; i++) await maintenance('log', 120);
        assert.equal((await api('/v1/sync/pull?after=2', { token })).status, 410);
        assert.deepEqual(
          await (await api(policy, { token, method: 'PUT', body: { days: null } })).json(),
          { days: null },
        );
      },
    );
    await t.test('concurrent refresh consumes once and revokes only its family', async () => {
      const session = await (await login(await identity('concurrent'))).json();
      const replies = await Promise.all([
        refresh(session.refresh_token),
        refresh(session.refresh_token),
      ]);
      assert.deepEqual(replies.map((r) => r.status).sort(), [200, 401]);
      const winner = await replies.find((r) => r.status === 200).json();
      assert.equal((await list(winner.access_token)).status, 401);
    });
  } finally {
    if (proc.exitCode === null && proc.signalCode === null) {
      const stopped = once(proc, 'exit');
      proc.kill('SIGTERM');
      const timer = setTimeout(() => proc.kill('SIGKILL'), 4000);
      try {
        await stopped;
      } finally {
        clearTimeout(timer);
      }
    }
  }
});
