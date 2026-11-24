-- Glossa 云同步 v1 D1 初始迁移。通过 Wrangler 应用，原子写走 D1 batch。时间为 Unix 毫秒。
-- id 为应用生成并经 Zod 校验的规范 UUID。逻辑时钟与 server_seq 经安全整数边界校验。
CREATE TABLE users (
  id TEXT PRIMARY KEY NOT NULL, issuer TEXT NOT NULL, subject TEXT NOT NULL,
  created_at INTEGER NOT NULL, UNIQUE (issuer, subject)
);
CREATE TABLE devices (
  user_id TEXT NOT NULL REFERENCES users(id), id TEXT NOT NULL, name TEXT NOT NULL,
  created_at INTEGER NOT NULL, last_seen_at INTEGER, revoked_at INTEGER,
  ack_seq INTEGER NOT NULL DEFAULT 0 CHECK (ack_seq >= 0),
  delivered_seq INTEGER NOT NULL DEFAULT 0 CHECK(delivered_seq >= ack_seq),
  last_lamport INTEGER NOT NULL DEFAULT 0 CHECK (last_lamport >= 0),
  PRIMARY KEY (user_id,id)
);
CREATE TABLE sessions (
  user_id TEXT NOT NULL, id TEXT NOT NULL, device_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL, revoked_at INTEGER,
  PRIMARY KEY (user_id,id), FOREIGN KEY (user_id,device_id) REFERENCES devices(user_id,id)
);
CREATE INDEX sessions_device ON sessions(user_id,device_id);
CREATE TABLE refresh_tokens (
  user_id TEXT NOT NULL, jti_digest TEXT NOT NULL, session_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL, used_at INTEGER, PRIMARY KEY (user_id,jti_digest),
  FOREIGN KEY (user_id,session_id) REFERENCES sessions(user_id,id)
);
CREATE INDEX refresh_family ON refresh_tokens(user_id,session_id);
CREATE TABLE sync_state (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id),
  head_seq INTEGER NOT NULL DEFAULT 0, floor_seq INTEGER NOT NULL DEFAULT 0,
  lamport INTEGER NOT NULL DEFAULT 0 CHECK(lamport>=0),
  CHECK (head_seq >= floor_seq AND floor_seq >= 0)
);
-- 插入 guard(ok=0) 使包含它的 D1 batch 以约束错误整体回滚。使用 INSERT ... ON CONFLICT(ok) DO NOTHING，仅忽略成功哨兵的主键重复。
CREATE TABLE write_guard (ok INTEGER PRIMARY KEY CHECK (ok = 1));
CREATE TABLE groups (
  user_id TEXT NOT NULL REFERENCES users(id), id TEXT NOT NULL, parent_id TEXT,
  name TEXT NOT NULL, name_key TEXT NOT NULL, sort_key TEXT NOT NULL,
  rev INTEGER NOT NULL, placement_rev INTEGER NOT NULL, deleted_at INTEGER,
  PRIMARY KEY (user_id,id), CHECK (parent_id IS NULL OR parent_id <> id),
  FOREIGN KEY (user_id,parent_id) REFERENCES groups(user_id,id)
);
CREATE UNIQUE INDEX groups_sibling_name ON groups(user_id,ifnull(parent_id,''),name_key)
  WHERE deleted_at IS NULL;
CREATE INDEX groups_children ON groups(user_id,parent_id,deleted_at,sort_key,id);
-- 由 D1 同一事务中的父链校验 + head_seq 比较写入保证间接无环。
CREATE TABLE books (
  user_id TEXT NOT NULL REFERENCES users(id), id TEXT NOT NULL, group_id TEXT,
  file_hash TEXT NOT NULL CHECK (length(file_hash)=64 AND file_hash NOT GLOB '*[^0-9a-f]*'),
  title TEXT NOT NULL, authors_json TEXT NOT NULL DEFAULT '[]' CHECK(json_type(authors_json)='array'),
  language TEXT, format TEXT NOT NULL, thumbhash TEXT,
  status TEXT NOT NULL DEFAULT 'unread' CHECK(status IN ('unread','reading','finished')),
  progress_bp INTEGER NOT NULL DEFAULT 0 CHECK(progress_bp BETWEEN 0 AND 10000),
  furthest_bp INTEGER NOT NULL DEFAULT 0 CHECK(furthest_bp BETWEEN progress_bp AND 10000),
  anchor_json TEXT CHECK(anchor_json IS NULL OR json_valid(anchor_json)),
  position_rev INTEGER NOT NULL DEFAULT 0, position_epoch INTEGER NOT NULL DEFAULT 0,
  finished_at INTEGER, deleted_at INTEGER, rev INTEGER NOT NULL,
  PRIMARY KEY (user_id,id), UNIQUE(user_id,file_hash),
  FOREIGN KEY(user_id,group_id) REFERENCES groups(user_id,id)
);
CREATE INDEX books_group ON books(user_id,group_id,deleted_at);
CREATE INDEX books_trash ON books(deleted_at,user_id,id) WHERE deleted_at IS NOT NULL;
CREATE TABLE annotations (
  user_id TEXT NOT NULL, id TEXT NOT NULL, book_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('highlight','note')), page_index INTEGER CHECK(page_index>=0),
  cfi TEXT, rects_json TEXT NOT NULL DEFAULT '[]' CHECK(json_type(rects_json)='array'),
  text_fingerprint TEXT, anchor_version INTEGER NOT NULL, note TEXT NOT NULL DEFAULT '',
  style_json TEXT NOT NULL DEFAULT '{}' CHECK(json_type(style_json)='object'),
  deleted_at INTEGER, rev INTEGER NOT NULL, PRIMARY KEY(user_id,id),
  CHECK(page_index IS NOT NULL OR cfi IS NOT NULL),
  FOREIGN KEY(user_id,book_id) REFERENCES books(user_id,id) ON DELETE CASCADE
);
CREATE INDEX annotations_book ON annotations(user_id,book_id,deleted_at,id);
-- 每个对象有独立物理代际。gc 可与同一逻辑 hash 的新代际并存。
CREATE TABLE objects (
  user_id TEXT NOT NULL REFERENCES users(id), id TEXT NOT NULL, object_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK(kind IN ('chunk','layout_manifest','search_sidecar','head_preview_chunk','cover_avif')),
  blake3 TEXT NOT NULL CHECK(length(blake3)=64 AND blake3 NOT GLOB '*[^0-9a-f]*'),
  bytes INTEGER NOT NULL CHECK(bytes>0), md5_b64 TEXT NOT NULL, mime TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('reserved','ready','gc')), etag TEXT,
  put_until INTEGER NOT NULL DEFAULT 0, keep_until INTEGER NOT NULL DEFAULT 0,
  retry_at INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(user_id,id)
);
CREATE UNIQUE INDEX objects_live_cas ON objects(user_id,kind,blake3) WHERE state <> 'gc';
CREATE INDEX objects_gc ON objects(state,retry_at,keep_until,put_until);
CREATE TABLE uploads (
  user_id TEXT NOT NULL, id TEXT NOT NULL, book_id TEXT NOT NULL, device_id TEXT NOT NULL,
  base_manifest_id TEXT, expires_at INTEGER NOT NULL,
  sealed_request_json TEXT CHECK(sealed_request_json IS NULL OR json_valid(sealed_request_json)),
  commit_op_id TEXT, last_error TEXT,
  state TEXT NOT NULL CHECK(state IN ('open','sealed','committed','aborted')),
  UNIQUE(user_id,commit_op_id),
  PRIMARY KEY(user_id,id), UNIQUE(user_id,book_id,id),
  FOREIGN KEY(user_id,book_id) REFERENCES books(user_id,id) ON DELETE CASCADE,
  FOREIGN KEY(user_id,device_id) REFERENCES devices(user_id,id)
);
CREATE INDEX uploads_expiry ON uploads(state,expires_at);
CREATE TABLE upload_objects (
  user_id TEXT NOT NULL, upload_id TEXT NOT NULL, object_id TEXT NOT NULL,
  verified_at INTEGER CHECK(verified_at IS NULL OR verified_at >= 0),
  PRIMARY KEY(user_id,upload_id,object_id),
  FOREIGN KEY(user_id,upload_id) REFERENCES uploads(user_id,id) ON DELETE CASCADE,
  FOREIGN KEY(user_id,object_id) REFERENCES objects(user_id,id)
);
CREATE INDEX upload_objects_pin ON upload_objects(user_id,object_id,upload_id);
-- upload id 同时作为不可变 manifest id；sealed 后禁止更改其成员。
CREATE TABLE manifest_chunks (
  user_id TEXT NOT NULL, manifest_id TEXT NOT NULL, ordinal INTEGER NOT NULL CHECK(ordinal>=0),
  object_id TEXT NOT NULL, start_byte INTEGER NOT NULL CHECK(start_byte>=0),
  end_byte INTEGER NOT NULL CHECK(end_byte>=start_byte), PRIMARY KEY(user_id,manifest_id,ordinal),
  FOREIGN KEY(user_id,manifest_id) REFERENCES uploads(user_id,id) ON DELETE CASCADE,
  FOREIGN KEY(user_id,object_id) REFERENCES objects(user_id,id)
);
CREATE INDEX manifest_seek ON manifest_chunks(user_id,manifest_id,end_byte);
CREATE INDEX manifest_chunk_refs ON manifest_chunks(user_id,object_id,manifest_id);
CREATE TABLE manifest_assets (
  user_id TEXT NOT NULL, manifest_id TEXT NOT NULL, role TEXT NOT NULL
    CHECK(role IN ('layout_manifest','search_sidecar','head_preview_chunk','cover_avif')),
  object_id TEXT NOT NULL, codec_version TEXT NOT NULL, PRIMARY KEY(user_id,manifest_id,role),
  FOREIGN KEY(user_id,manifest_id) REFERENCES uploads(user_id,id) ON DELETE CASCADE,
  FOREIGN KEY(user_id,object_id) REFERENCES objects(user_id,id)
);
CREATE INDEX manifest_asset_refs ON manifest_assets(user_id,object_id,manifest_id);
CREATE TABLE current_manifests (
  user_id TEXT NOT NULL, book_id TEXT NOT NULL, manifest_id TEXT NOT NULL,
  file_bytes INTEGER NOT NULL CHECK(file_bytes>0), chunk_count INTEGER NOT NULL CHECK(chunk_count>0),
  profile TEXT NOT NULL, manifest_digest TEXT NOT NULL, rev INTEGER NOT NULL,
  PRIMARY KEY(user_id,book_id),
  FOREIGN KEY(user_id,book_id,manifest_id) REFERENCES uploads(user_id,book_id,id) ON DELETE CASCADE
);
CREATE VIEW unverified_manifest_objects AS
  SELECT m.user_id,m.manifest_id,m.object_id FROM (
    SELECT user_id,manifest_id,object_id FROM manifest_chunks UNION ALL
    SELECT user_id,manifest_id,object_id FROM manifest_assets
  ) m LEFT JOIN upload_objects u
    ON (u.user_id,u.upload_id,u.object_id)=(m.user_id,m.manifest_id,m.object_id)
  JOIN objects o ON (o.user_id,o.id)=(m.user_id,m.object_id)
  WHERE u.verified_at IS NULL OR o.state <> 'ready';
CREATE TRIGGER require_verified_manifest_insert
BEFORE INSERT ON current_manifests
WHEN EXISTS (SELECT 1 FROM unverified_manifest_objects
             WHERE user_id=NEW.user_id AND manifest_id=NEW.manifest_id)
BEGIN
  SELECT RAISE(ABORT,'manifest_object_unverified');
END;
CREATE TRIGGER require_verified_manifest_update
BEFORE UPDATE ON current_manifests
WHEN EXISTS (SELECT 1 FROM unverified_manifest_objects
             WHERE user_id=NEW.user_id AND manifest_id=NEW.manifest_id)
BEGIN
  SELECT RAISE(ABORT,'manifest_object_unverified');
END;
-- 封面键由当前清单投影到热数据；事务日志也带该值，避免两个可写副本。
CREATE VIEW book_covers AS
  SELECT c.user_id,c.book_id,o.object_key AS cover_avif_key
  FROM current_manifests c JOIN manifest_assets a ON
    (a.user_id,a.manifest_id,a.role)=(c.user_id,c.manifest_id,'cover_avif')
  JOIN objects o ON (o.user_id,o.id)=(a.user_id,a.object_id);
-- 权威引用计数按实际映射派生；重复使用同一块的多个 ordinal 各计一次。
CREATE VIEW object_refcounts AS
  SELECT r.user_id,r.object_id,count(*) AS refs FROM (
    SELECT user_id,object_id FROM manifest_chunks UNION ALL
    SELECT user_id,object_id FROM manifest_assets
  ) r GROUP BY r.user_id,r.object_id;
CREATE TABLE oplog (
  user_id TEXT NOT NULL REFERENCES users(id), server_seq INTEGER NOT NULL CHECK(server_seq>0),
  event_json TEXT NOT NULL CHECK(json_valid(event_json)), created_at INTEGER NOT NULL,
  PRIMARY KEY(user_id,server_seq)
);
CREATE TABLE op_receipts (
  user_id TEXT NOT NULL REFERENCES users(id), op_id TEXT NOT NULL, device_id TEXT,
  request_digest TEXT NOT NULL, result_json TEXT NOT NULL CHECK(json_valid(result_json)),
  created_at INTEGER NOT NULL, PRIMARY KEY(user_id,op_id),
  FOREIGN KEY(user_id,device_id) REFERENCES devices(user_id,id)
);
-- 只留身份和删除水位。旧设备和旧上传任务均不得重新创建相同实体 UUID。
CREATE TABLE purge_fences (
  user_id TEXT NOT NULL REFERENCES users(id), kind TEXT NOT NULL, id TEXT NOT NULL,
  purge_seq INTEGER NOT NULL, PRIMARY KEY(user_id,kind,id)
);

ALTER TABLE upload_objects ADD COLUMN codec_version TEXT;
CREATE TABLE manifest_parts (
  user_id TEXT NOT NULL, upload_id TEXT NOT NULL, part INTEGER NOT NULL CHECK(part>=0),
  count INTEGER NOT NULL CHECK(count BETWEEN 1 AND 128), end_byte INTEGER NOT NULL,
  digest TEXT NOT NULL, prefix_digest TEXT NOT NULL,
  PRIMARY KEY(user_id,upload_id,part),
  FOREIGN KEY(user_id,upload_id) REFERENCES uploads(user_id,id) ON DELETE CASCADE
);
CREATE INDEX oplog_retention ON oplog(created_at,user_id,server_seq);
CREATE TABLE trash_policy (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id),
  days INTEGER NOT NULL CHECK(days BETWEEN 1 AND 3650)
);

-- Frozen manifests pin their actual members. An optional sidecar or superseded
-- chunk negotiated during preparation must not inherit the book's lifetime.
CREATE TRIGGER release_unused_upload_leases
AFTER UPDATE OF state ON uploads
WHEN NEW.state='committed' AND OLD.state<>'committed'
BEGIN
  DELETE FROM upload_objects
  WHERE user_id=NEW.user_id AND upload_id=NEW.id
    AND NOT EXISTS (SELECT 1 FROM manifest_chunks c WHERE
      (c.user_id,c.manifest_id,c.object_id)=(upload_objects.user_id,upload_objects.upload_id,upload_objects.object_id))
    AND NOT EXISTS (SELECT 1 FROM manifest_assets a WHERE
      (a.user_id,a.manifest_id,a.object_id)=(upload_objects.user_id,upload_objects.upload_id,upload_objects.object_id));
END;

-- Apply the same rule to books published by earlier Workers.
DELETE FROM upload_objects
WHERE EXISTS (SELECT 1 FROM uploads u WHERE
    (u.user_id,u.id)=(upload_objects.user_id,upload_objects.upload_id) AND u.state='committed')
  AND NOT EXISTS (SELECT 1 FROM manifest_chunks c WHERE
    (c.user_id,c.manifest_id,c.object_id)=(upload_objects.user_id,upload_objects.upload_id,upload_objects.object_id))
  AND NOT EXISTS (SELECT 1 FROM manifest_assets a WHERE
    (a.user_id,a.manifest_id,a.object_id)=(upload_objects.user_id,upload_objects.upload_id,upload_objects.object_id));
