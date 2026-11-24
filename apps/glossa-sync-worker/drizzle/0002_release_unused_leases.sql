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
