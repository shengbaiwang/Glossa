import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { getTableName, isTable } from 'drizzle-orm';
import { getTableConfig, getViewConfig } from 'drizzle-orm/sqlite-core';
import * as schema from '../src/db/schema.ts';

const migration = (name) => readFile(new URL('../drizzle/' + name, import.meta.url), 'utf8');

test('the ORM maps every migrated table and view, including ordered primary keys', async (t) => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const { entries } = JSON.parse(await migration('meta/_journal.json'));
  for (const { tag } of entries) db.exec(await migration(tag + '.sql'));
  const tableNames = [];
  const viewNames = [];
  const columnsOf = (name) => db.prepare('SELECT * FROM pragma_table_info(?) ORDER BY cid').all(name);
  for (const value of Object.values(schema)) {
    if (isTable(value)) {
      const name = getTableName(value);
      tableNames.push(name);
      const mapped = getTableConfig(value);
      const actual = columnsOf(name);
      assert.deepEqual(mapped.columns.map((c) => [c.name, c.getSQLType()]),
        actual.map((c) => [c.name, c.type.toLowerCase()]), name);
      const pk = mapped.primaryKeys[0]?.columns ?? mapped.columns.filter((c) => c.primary);
      assert.deepEqual(pk.map((c) => c.name),
        actual.filter((c) => c.pk).sort((a,b) => a.pk-b.pk).map((c) => c.name), name);
    } else {
      const view = getViewConfig(value);
      viewNames.push(view.name);
      assert.deepEqual(Object.values(view.selectedFields).map((c) => c.name),
        columnsOf(view.name).map((c) => c.name), view.name);
    }
  }
  const namesOf = (type) => db.prepare('SELECT name FROM sqlite_schema WHERE type=? ORDER BY name')
    .all(type).map((r) => r.name);
  assert.deepEqual(tableNames.sort(), namesOf('table'));
  assert.deepEqual(viewNames.sort(), namesOf('view'));
});

test('upgrading published manifests releases only unused leases and preserves open work', async (t) => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(await migration('0000_cloud.sql'));
  db.exec(await migration('0001_upload_assets.sql'));
  db.exec(`
    INSERT INTO users VALUES('user','issuer','subject',0);
    INSERT INTO devices(user_id,id,name,created_at) VALUES('user','device','Reader',0);
    INSERT INTO books(user_id,id,file_hash,title,format,rev)
      VALUES('user','book',lower(hex(zeroblob(32))),'Fixture','pdf',1);
    INSERT INTO uploads(user_id,id,book_id,device_id,expires_at,state)
      VALUES('user','published','book','device',100,'committed'),('user','draft','book','device',100,'open');
  `);
  for (const [index, kind] of ['chunk','layout_manifest','search_sidecar'].entries()) {
    db.prepare(`INSERT INTO objects(user_id,id,object_key,kind,blake3,bytes,md5_b64,mime,state)
      VALUES('user',?,?,?,lower(hex(zeroblob(32))),1,'fixture','application/octet-stream','ready')`)
      .run(kind, 'key'+index, kind);
    for (const upload of ['published','draft']) {
      db.prepare("INSERT INTO upload_objects VALUES('user',?,?,1,NULL)").run(upload,kind);
    }
  }
  db.exec(`
    INSERT INTO manifest_chunks VALUES('user','published',0,'chunk',0,0);
    INSERT INTO manifest_assets VALUES('user','published','layout_manifest','layout_manifest','v1');
    INSERT INTO current_manifests VALUES('user','book','published',1,1,'v1','digest',1);
  `);
  db.exec(await migration('0002_release_unused_leases.sql'));
  const pins = (upload) => db.prepare('SELECT object_id FROM upload_objects WHERE upload_id=? ORDER BY object_id')
    .all(upload).map((r) => r.object_id);
  assert.deepEqual(pins('published'), ['chunk', 'layout_manifest']);
  assert.deepEqual(pins('draft'), ['chunk', 'layout_manifest', 'search_sidecar']);
  assert.equal(db.prepare('SELECT count(*) AS n FROM unverified_manifest_objects').get().n, 0);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});
