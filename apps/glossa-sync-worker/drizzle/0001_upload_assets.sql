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
