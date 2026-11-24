// Drizzle maps the control plane. Custom SQL migrations also install the publication triggers.
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  sqliteView,
  text,
  unique,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

export const users = sqliteTable(
  'users',
  {
    id: text().notNull().primaryKey(),
    issuer: text().notNull(),
    subject: text().notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [unique().on(t.issuer, t.subject)],
);

export const devices = sqliteTable(
  'devices',
  {
    userId: text('user_id').notNull(),
    id: text().notNull(),
    name: text().notNull(),
    createdAt: integer('created_at').notNull(),
    lastSeenAt: integer('last_seen_at'),
    revokedAt: integer('revoked_at'),
    ackSeq: integer('ack_seq').notNull().default(0),
    deliveredSeq: integer('delivered_seq').notNull().default(0),
    lastLamport: integer('last_lamport').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.id] }),
    check('devices_check_1', sql`ack_seq >= 0`),
    check('devices_check_2', sql`delivered_seq >= ack_seq`),
    check('devices_check_3', sql`last_lamport >= 0`),
    foreignKey({ columns: [t.userId], foreignColumns: [users.id] }),
  ],
);

export const sessions = sqliteTable(
  'sessions',
  {
    userId: text('user_id').notNull(),
    id: text().notNull(),
    deviceId: text('device_id').notNull(),
    expiresAt: integer('expires_at').notNull(),
    revokedAt: integer('revoked_at'),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.id] }),
    foreignKey({ columns: [t.userId, t.deviceId], foreignColumns: [devices.userId, devices.id] }),
    index('sessions_device').on(t.userId, t.deviceId),
  ],
);

export const refreshTokens = sqliteTable(
  'refresh_tokens',
  {
    userId: text('user_id').notNull(),
    jtiDigest: text('jti_digest').notNull(),
    sessionId: text('session_id').notNull(),
    expiresAt: integer('expires_at').notNull(),
    usedAt: integer('used_at'),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.jtiDigest] }),
    foreignKey({
      columns: [t.userId, t.sessionId],
      foreignColumns: [sessions.userId, sessions.id],
    }),
    index('refresh_family').on(t.userId, t.sessionId),
  ],
);

export const syncState = sqliteTable(
  'sync_state',
  {
    userId: text('user_id').notNull().primaryKey(),
    headSeq: integer('head_seq').notNull().default(0),
    floorSeq: integer('floor_seq').notNull().default(0),
    lamport: integer().notNull().default(0),
  },
  (t) => [
    check('sync_state_check_0', sql`lamport>=0`),
    check('sync_state_check_1', sql`head_seq >= floor_seq AND floor_seq >= 0`),
    foreignKey({ columns: [t.userId], foreignColumns: [users.id] }),
  ],
);

export const writeGuard = sqliteTable(
  'write_guard',
  {
    ok: integer().primaryKey({ autoIncrement: false }),
  },
  (t) => [check('write_guard_check_0', sql`ok = 1`)],
);

export const groups = sqliteTable(
  'groups',
  {
    userId: text('user_id').notNull(),
    id: text().notNull(),
    parentId: text('parent_id'),
    name: text().notNull(),
    nameKey: text('name_key').notNull(),
    sortKey: text('sort_key').notNull(),
    rev: integer().notNull(),
    placementRev: integer('placement_rev').notNull(),
    deletedAt: integer('deleted_at'),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.id] }),
    check('groups_check_1', sql`parent_id IS NULL OR parent_id <> id`),
    foreignKey({ columns: [t.userId, t.parentId], foreignColumns: [t.userId, t.id] }),
    foreignKey({ columns: [t.userId], foreignColumns: [users.id] }),
    index('groups_children').on(t.userId, t.parentId, t.deletedAt, t.sortKey, t.id),
    uniqueIndex('groups_sibling_name')
      .on(t.userId, sql`ifnull(parent_id,'')`, t.nameKey)
      .where(sql`deleted_at IS NULL`),
  ],
);

export const books = sqliteTable(
  'books',
  {
    userId: text('user_id').notNull(),
    id: text().notNull(),
    groupId: text('group_id'),
    fileHash: text('file_hash').notNull(),
    title: text().notNull(),
    authorsJson: text('authors_json').notNull().default('[]'),
    language: text(),
    format: text().notNull(),
    thumbhash: text(),
    status: text().notNull().default('unread'),
    progressBp: integer('progress_bp').notNull().default(0),
    furthestBp: integer('furthest_bp').notNull().default(0),
    anchorJson: text('anchor_json'),
    positionRev: integer('position_rev').notNull().default(0),
    positionEpoch: integer('position_epoch').notNull().default(0),
    finishedAt: integer('finished_at'),
    deletedAt: integer('deleted_at'),
    rev: integer().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.id] }),
    check('books_check_1', sql`length(file_hash)=64 AND file_hash NOT GLOB '*[^0-9a-f]*'`),
    check('books_check_2', sql`json_type(authors_json)='array'`),
    check('books_check_3', sql`status IN ('unread','reading','finished')`),
    check('books_check_4', sql`progress_bp BETWEEN 0 AND 10000`),
    check('books_check_5', sql`furthest_bp BETWEEN progress_bp AND 10000`),
    check('books_check_6', sql`anchor_json IS NULL OR json_valid(anchor_json)`),
    foreignKey({ columns: [t.userId, t.groupId], foreignColumns: [groups.userId, groups.id] }),
    foreignKey({ columns: [t.userId], foreignColumns: [users.id] }),
    index('books_trash').on(t.deletedAt, t.userId, t.id).where(sql`deleted_at IS NOT NULL`),
    index('books_group').on(t.userId, t.groupId, t.deletedAt),
    unique().on(t.userId, t.fileHash),
  ],
);

export const annotations = sqliteTable(
  'annotations',
  {
    userId: text('user_id').notNull(),
    id: text().notNull(),
    bookId: text('book_id').notNull(),
    kind: text().notNull(),
    pageIndex: integer('page_index'),
    cfi: text(),
    rectsJson: text('rects_json').notNull().default('[]'),
    textFingerprint: text('text_fingerprint'),
    anchorVersion: integer('anchor_version').notNull(),
    note: text().notNull().default(''),
    styleJson: text('style_json').notNull().default('{}'),
    deletedAt: integer('deleted_at'),
    rev: integer().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.id] }),
    check('annotations_check_1', sql`kind IN ('highlight','note')`),
    check('annotations_check_2', sql`page_index>=0`),
    check('annotations_check_3', sql`json_type(rects_json)='array'`),
    check('annotations_check_4', sql`json_type(style_json)='object'`),
    check('annotations_check_5', sql`page_index IS NOT NULL OR cfi IS NOT NULL`),
    foreignKey({
      columns: [t.userId, t.bookId],
      foreignColumns: [books.userId, books.id],
    }).onDelete('cascade'),
    index('annotations_book').on(t.userId, t.bookId, t.deletedAt, t.id),
  ],
);

export const objects = sqliteTable(
  'objects',
  {
    userId: text('user_id').notNull(),
    id: text().notNull(),
    objectKey: text('object_key').notNull(),
    kind: text().notNull(),
    blake3: text().notNull(),
    bytes: integer().notNull(),
    md5B64: text('md5_b64').notNull(),
    mime: text().notNull(),
    state: text().notNull(),
    etag: text(),
    putUntil: integer('put_until').notNull().default(0),
    keepUntil: integer('keep_until').notNull().default(0),
    retryAt: integer('retry_at').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.id] }),
    check(
      'objects_check_1',
      sql`kind IN ('chunk','layout_manifest','search_sidecar','head_preview_chunk','cover_avif')`,
    ),
    check('objects_check_2', sql`length(blake3)=64 AND blake3 NOT GLOB '*[^0-9a-f]*'`),
    check('objects_check_3', sql`bytes>0`),
    check('objects_check_4', sql`state IN ('reserved','ready','gc')`),
    foreignKey({ columns: [t.userId], foreignColumns: [users.id] }),
    index('objects_gc').on(t.state, t.retryAt, t.keepUntil, t.putUntil),
    uniqueIndex('objects_live_cas').on(t.userId, t.kind, t.blake3).where(sql`state <> 'gc'`),
    unique().on(t.objectKey),
  ],
);

export const uploads = sqliteTable(
  'uploads',
  {
    userId: text('user_id').notNull(),
    id: text().notNull(),
    bookId: text('book_id').notNull(),
    deviceId: text('device_id').notNull(),
    baseManifestId: text('base_manifest_id'),
    expiresAt: integer('expires_at').notNull(),
    sealedRequestJson: text('sealed_request_json'),
    commitOpId: text('commit_op_id'),
    lastError: text('last_error'),
    state: text().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.id] }),
    check('uploads_check_1', sql`sealed_request_json IS NULL OR json_valid(sealed_request_json)`),
    check('uploads_check_2', sql`state IN ('open','sealed','committed','aborted')`),
    foreignKey({ columns: [t.userId, t.deviceId], foreignColumns: [devices.userId, devices.id] }),
    foreignKey({
      columns: [t.userId, t.bookId],
      foreignColumns: [books.userId, books.id],
    }).onDelete('cascade'),
    index('uploads_expiry').on(t.state, t.expiresAt),
    unique().on(t.userId, t.bookId, t.id),
    unique().on(t.userId, t.commitOpId),
  ],
);

export const uploadObjects = sqliteTable(
  'upload_objects',
  {
    userId: text('user_id').notNull(),
    uploadId: text('upload_id').notNull(),
    objectId: text('object_id').notNull(),
    verifiedAt: integer('verified_at'),
    codecVersion: text('codec_version'),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.uploadId, t.objectId] }),
    check('upload_objects_check_1', sql`verified_at IS NULL OR verified_at >= 0`),
    foreignKey({ columns: [t.userId, t.objectId], foreignColumns: [objects.userId, objects.id] }),
    foreignKey({
      columns: [t.userId, t.uploadId],
      foreignColumns: [uploads.userId, uploads.id],
    }).onDelete('cascade'),
    index('upload_objects_pin').on(t.userId, t.objectId, t.uploadId),
  ],
);

export const manifestChunks = sqliteTable(
  'manifest_chunks',
  {
    userId: text('user_id').notNull(),
    manifestId: text('manifest_id').notNull(),
    ordinal: integer().notNull(),
    objectId: text('object_id').notNull(),
    startByte: integer('start_byte').notNull(),
    endByte: integer('end_byte').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.manifestId, t.ordinal] }),
    check('manifest_chunks_check_1', sql`ordinal>=0`),
    check('manifest_chunks_check_2', sql`start_byte>=0`),
    check('manifest_chunks_check_3', sql`end_byte>=start_byte`),
    foreignKey({ columns: [t.userId, t.objectId], foreignColumns: [objects.userId, objects.id] }),
    foreignKey({
      columns: [t.userId, t.manifestId],
      foreignColumns: [uploads.userId, uploads.id],
    }).onDelete('cascade'),
    index('manifest_chunk_refs').on(t.userId, t.objectId, t.manifestId),
    index('manifest_seek').on(t.userId, t.manifestId, t.endByte),
  ],
);

export const manifestAssets = sqliteTable(
  'manifest_assets',
  {
    userId: text('user_id').notNull(),
    manifestId: text('manifest_id').notNull(),
    role: text().notNull(),
    objectId: text('object_id').notNull(),
    codecVersion: text('codec_version').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.manifestId, t.role] }),
    check(
      'manifest_assets_check_1',
      sql`role IN ('layout_manifest','search_sidecar','head_preview_chunk','cover_avif')`,
    ),
    foreignKey({ columns: [t.userId, t.objectId], foreignColumns: [objects.userId, objects.id] }),
    foreignKey({
      columns: [t.userId, t.manifestId],
      foreignColumns: [uploads.userId, uploads.id],
    }).onDelete('cascade'),
    index('manifest_asset_refs').on(t.userId, t.objectId, t.manifestId),
  ],
);

export const currentManifests = sqliteTable(
  'current_manifests',
  {
    userId: text('user_id').notNull(),
    bookId: text('book_id').notNull(),
    manifestId: text('manifest_id').notNull(),
    fileBytes: integer('file_bytes').notNull(),
    chunkCount: integer('chunk_count').notNull(),
    profile: text().notNull(),
    manifestDigest: text('manifest_digest').notNull(),
    rev: integer().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.bookId] }),
    check('current_manifests_check_1', sql`file_bytes>0`),
    check('current_manifests_check_2', sql`chunk_count>0`),
    foreignKey({
      columns: [t.userId, t.bookId, t.manifestId],
      foreignColumns: [uploads.userId, uploads.bookId, uploads.id],
    }).onDelete('cascade'),
  ],
);

export const oplog = sqliteTable(
  'oplog',
  {
    userId: text('user_id').notNull(),
    serverSeq: integer('server_seq').notNull(),
    eventJson: text('event_json').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.serverSeq] }),
    check('oplog_check_1', sql`server_seq>0`),
    check('oplog_check_2', sql`json_valid(event_json)`),
    foreignKey({ columns: [t.userId], foreignColumns: [users.id] }),
    index('oplog_retention').on(t.createdAt, t.userId, t.serverSeq),
  ],
);

export const opReceipts = sqliteTable(
  'op_receipts',
  {
    userId: text('user_id').notNull(),
    opId: text('op_id').notNull(),
    deviceId: text('device_id'),
    requestDigest: text('request_digest').notNull(),
    resultJson: text('result_json').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.opId] }),
    check('op_receipts_check_1', sql`json_valid(result_json)`),
    foreignKey({ columns: [t.userId, t.deviceId], foreignColumns: [devices.userId, devices.id] }),
    foreignKey({ columns: [t.userId], foreignColumns: [users.id] }),
  ],
);

export const purgeFences = sqliteTable(
  'purge_fences',
  {
    userId: text('user_id').notNull(),
    kind: text().notNull(),
    id: text().notNull(),
    purgeSeq: integer('purge_seq').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.kind, t.id] }),
    foreignKey({ columns: [t.userId], foreignColumns: [users.id] }),
  ],
);

export const manifestParts = sqliteTable(
  'manifest_parts',
  {
    userId: text('user_id').notNull(),
    uploadId: text('upload_id').notNull(),
    part: integer().notNull(),
    count: integer().notNull(),
    endByte: integer('end_byte').notNull(),
    digest: text().notNull(),
    prefixDigest: text('prefix_digest').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.uploadId, t.part] }),
    check('manifest_parts_check_1', sql`part>=0`),
    check('manifest_parts_check_2', sql`count BETWEEN 1 AND 128`),
    foreignKey({
      columns: [t.userId, t.uploadId],
      foreignColumns: [uploads.userId, uploads.id],
    }).onDelete('cascade'),
  ],
);

export const trashPolicy = sqliteTable(
  'trash_policy',
  {
    userId: text('user_id').notNull().primaryKey(),
    days: integer().notNull(),
  },
  (t) => [
    check('trash_policy_check_0', sql`days BETWEEN 1 AND 3650`),
    foreignKey({ columns: [t.userId], foreignColumns: [users.id] }),
  ],
);

export const unverifiedManifestObjects = sqliteView('unverified_manifest_objects', {
  userId: text('user_id').notNull(),
  manifestId: text('manifest_id').notNull(),
  objectId: text('object_id').notNull(),
}).as(sql`SELECT m.user_id,m.manifest_id,m.object_id FROM (
    SELECT user_id,manifest_id,object_id FROM manifest_chunks UNION ALL
    SELECT user_id,manifest_id,object_id FROM manifest_assets
  ) m LEFT JOIN upload_objects u
    ON (u.user_id,u.upload_id,u.object_id)=(m.user_id,m.manifest_id,m.object_id)
  JOIN objects o ON (o.user_id,o.id)=(m.user_id,m.object_id)
  WHERE u.verified_at IS NULL OR o.state <> 'ready'`);

export const bookCovers = sqliteView('book_covers', {
  userId: text('user_id').notNull(),
  bookId: text('book_id').notNull(),
  coverAvifKey: text('cover_avif_key').notNull(),
}).as(sql`SELECT c.user_id,c.book_id,o.object_key AS cover_avif_key
  FROM current_manifests c JOIN manifest_assets a ON
    (a.user_id,a.manifest_id,a.role)=(c.user_id,c.manifest_id,'cover_avif')
  JOIN objects o ON (o.user_id,o.id)=(a.user_id,a.object_id)`);

export const objectRefcounts = sqliteView('object_refcounts', {
  userId: text('user_id').notNull(),
  objectId: text('object_id').notNull(),
  refs: integer('refs').notNull(),
}).as(sql`SELECT r.user_id,r.object_id,count(*) AS refs FROM (
    SELECT user_id,object_id FROM manifest_chunks UNION ALL
    SELECT user_id,object_id FROM manifest_assets
  ) r GROUP BY r.user_id,r.object_id`);
