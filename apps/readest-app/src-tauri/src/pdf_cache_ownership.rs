//! PDF sidecars are private to one book and one writer generation. Legacy shared data is
//! copied on verified access and can only be removed by a separate, reviewed cleanup.
use md5::{Digest, Md5};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Owner {
    pub book_id: String,
    pub revision: u64,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct State {
    book_id: String,
    revision: u64,
    blocked: bool,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Manifest {
    owner: Owner,
    fingerprint: String,
    #[serde(default)]
    ready: bool,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LegacyCache {
    pub id: String,
    pub stamp: String,
}
fn err(_: impl std::fmt::Debug) -> String {
    "pdf_storage_error".into()
}
fn digest(bytes: impl AsRef<[u8]>) -> String {
    format!("{:x}", Md5::digest(bytes))
}
pub fn valid_id(id: &str) -> bool {
    id.len() == 32
        && id
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}
fn valid_book(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 200
        && id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
}
fn safe_dir(path: &Path) -> Result<bool, String> {
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.file_type().is_symlink() || !meta.is_dir() => {
            Err("pdf_storage_error".into())
        }
        Ok(_) => Ok(true),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(err(e)),
    }
}
fn read<T: serde::de::DeserializeOwned>(path: &Path) -> Result<T, String> {
    let meta = fs::symlink_metadata(path).map_err(err)?;
    if meta.file_type().is_symlink() || !meta.is_file() || meta.len() > 65536 {
        return Err("pdf_storage_error".into());
    }
    serde_json::from_slice(&fs::read(path).map_err(err)?).map_err(err)
}
fn state_path(root: &Path, book: &str) -> Result<PathBuf, String> {
    if !valid_book(book) {
        return Err("invalid_pdf_owner".into());
    }
    safe_dir(root)?;
    let owners = root.join("owners");
    safe_dir(&owners)?;
    Ok(owners.join(format!("{}.json", digest(book))))
}
fn state(root: &Path, book: &str) -> Result<Option<State>, String> {
    let path = state_path(root, book)?;
    if !path.try_exists().map_err(err)? {
        return Ok(None);
    }
    let value: State = read(&path)?;
    if value.book_id != book {
        return Err("invalid_pdf_owner".into());
    }
    Ok(Some(value))
}
fn save_state(root: &Path, value: &State) -> Result<(), String> {
    let path = state_path(root, &value.book_id)?;
    fs::create_dir_all(path.parent().ok_or("pdf_storage_error")?).map_err(err)?;
    let temp = path.with_extension("tmp");
    // Never follow a leftover link at an application-owned temporary path.
    if temp.symlink_metadata().is_ok() {
        fs::remove_file(&temp).map_err(err)?;
    }
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp)
        .map_err(err)?;
    use std::io::Write;
    file.write_all(&serde_json::to_vec(value).map_err(err)?)
        .and_then(|_| file.sync_all())
        .map_err(err)?;
    fs::rename(temp, path).map_err(err)
}
fn copy_tree(from: &Path, to: &Path) -> Result<(), String> {
    safe_dir(from)?;
    fs::create_dir_all(to).map_err(err)?;
    for entry in fs::read_dir(from).map_err(err)? {
        let entry = entry.map_err(err)?;
        let meta = entry.file_type().map_err(err)?;
        if entry.file_name() == "owner.json" {
            continue;
        }
        if meta.is_symlink() {
            return Err("pdf_storage_error".into());
        }
        if meta.is_dir() {
            copy_tree(&entry.path(), &to.join(entry.file_name()))?;
        } else if meta.is_file() {
            fs::copy(entry.path(), to.join(entry.file_name())).map_err(err)?;
        }
    }
    Ok(())
}
pub fn open(
    root: &Path,
    fingerprint: &str,
    owner: Option<&Owner>,
    create: bool,
) -> Result<Option<String>, String> {
    if !valid_id(fingerprint) {
        return Err("invalid_pdf_cache".into());
    }
    safe_dir(root)?;
    let Some(owner) = owner else {
        let dir = root.join(fingerprint);
        access(root, fingerprint, Some(fingerprint))?;
        if !safe_dir(&dir)? && !create {
            return Ok(None);
        }
        fs::create_dir_all(dir).map_err(err)?;
        return Ok(Some(fingerprint.into()));
    };
    let previous = state(root, &owner.book_id)?;
    if previous
        .as_ref()
        .is_some_and(|s| owner.revision < s.revision || (s.blocked && owner.revision <= s.revision))
    {
        return Err("pdf_book_deleted".into());
    }
    save_state(
        root,
        &State {
            book_id: owner.book_id.clone(),
            revision: owner.revision,
            blocked: false,
        },
    )?;
    let id = digest(format!(
        "{}:{}:{}",
        owner.book_id, owner.revision, fingerprint
    ));
    let dir = root.join(&id);
    if safe_dir(&dir)? {
        access(root, &id, Some(fingerprint))?;
        if read::<Manifest>(&dir.join("owner.json"))?.ready {
            return Ok(Some(id));
        }
    }
    let legacy = root.join(fingerprint);
    // Scan durable manifests as well as the ledger: a failed copy may already
    // have advanced the ledger to this generation. Retry from a complete source.
    let mut prior = None;
    if safe_dir(root)? {
        for entry in fs::read_dir(root).map_err(err)? {
            let entry = entry.map_err(err)?;
            if entry.path() == dir || !valid_id(&entry.file_name().to_string_lossy()) {
                continue;
            }
            safe_dir(&entry.path())?;
            let manifest = entry.path().join("owner.json");
            if !manifest.try_exists().map_err(err)? {
                continue;
            }
            let value: Manifest = read(&manifest)?;
            if value.ready
                && value.owner.book_id == owner.book_id
                && value.fingerprint == fingerprint
                && value.owner.revision < owner.revision
                && prior
                    .as_ref()
                    .map_or(true, |(revision, _)| *revision < value.owner.revision)
            {
                prior = Some((value.owner.revision, entry.path()));
            }
        }
    }
    let from = if let Some((_, path)) = prior.as_ref() {
        Some(path)
    } else if safe_dir(&legacy)? {
        Some(&legacy)
    } else {
        None
    };
    if !create && from.is_none() {
        return Ok(None);
    }
    // A durable manifest precedes copying, so interrupted migration remains attributable.
    fs::create_dir_all(&dir).map_err(err)?;
    let mut manifest = Manifest {
        owner: owner.clone(),
        fingerprint: fingerprint.into(),
        ready: false,
    };
    fs::write(
        dir.join("owner.json"),
        serde_json::to_vec(&manifest).map_err(err)?,
    )
    .map_err(err)?;
    if let Some(from) = from {
        copy_tree(from, &dir)?;
    }
    manifest.ready = true;
    fs::write(
        dir.join("owner.json"),
        serde_json::to_vec(&manifest).map_err(err)?,
    )
    .map_err(err)?;
    Ok(Some(id))
}
pub fn access(root: &Path, id: &str, fingerprint: Option<&str>) -> Result<(), String> {
    if !valid_id(id) {
        return Err("invalid_pdf_cache".into());
    }
    safe_dir(root)?;
    let dir = root.join(id);
    safe_dir(&dir)?;
    let manifest = dir.join("owner.json");
    if !manifest.try_exists().map_err(err)? {
        let blocked = root.join("legacy-blocked");
        safe_dir(&blocked)?;
        if blocked
            .join(format!("{id}.json"))
            .try_exists()
            .map_err(err)?
        {
            return Err("pdf_book_deleted".into());
        }
        if fingerprint.is_some_and(|f| f != id) {
            return Err("pdf_source_changed".into());
        }
        return Ok(());
    }
    let value: Manifest = read(&manifest)?;
    if id
        != digest(format!(
            "{}:{}:{}",
            value.owner.book_id, value.owner.revision, value.fingerprint
        ))
    {
        return Err("invalid_pdf_owner".into());
    }
    if fingerprint.is_some_and(|f| f != value.fingerprint) {
        return Err("pdf_source_changed".into());
    }
    let current = state(root, &value.owner.book_id)?.ok_or("pdf_book_deleted")?;
    if current.blocked || current.revision != value.owner.revision {
        return Err("pdf_book_deleted".into());
    }
    Ok(())
}
pub fn block(root: &Path, book: &str, revision: u64) -> Result<Vec<String>, String> {
    if let Some(current) = state(root, book)? {
        if revision < current.revision || (!current.blocked && revision <= current.revision) {
            return Err("pdf_book_restored".into());
        }
    }
    save_state(
        root,
        &State {
            book_id: book.into(),
            revision,
            blocked: true,
        },
    )?;
    let mut ids = Vec::new();
    for entry in fs::read_dir(root).map_err(err)? {
        let entry = entry.map_err(err)?;
        let id = entry.file_name().to_string_lossy().into_owned();
        if !valid_id(&id) {
            continue;
        }
        safe_dir(&entry.path())?;
        let path = entry.path().join("owner.json");
        if !path.try_exists().map_err(err)? {
            continue;
        }
        let manifest: Manifest = read(&path)?;
        if manifest.owner.book_id == book {
            ids.push(id);
        }
    }
    Ok(ids)
}
pub fn remove(root: &Path, ids: &[String]) -> Result<(), String> {
    for id in ids {
        if !valid_id(id) {
            return Err("invalid_pdf_cache".into());
        }
        let path = root.join(id);
        if safe_dir(&path)? {
            fs::remove_dir_all(path).map_err(err)?;
        }
    }
    Ok(())
}
fn stamp(path: &Path, hash: &mut Md5) -> Result<(), String> {
    safe_dir(path)?;
    let mut entries = fs::read_dir(path)
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        let meta = fs::symlink_metadata(entry.path()).map_err(err)?;
        if meta.file_type().is_symlink() {
            return Err("pdf_storage_error".into());
        }
        hash.update(entry.file_name().as_encoded_bytes());
        hash.update(meta.len().to_le_bytes());
        hash.update(
            meta.modified()
                .map_err(err)?
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(err)?
                .as_nanos()
                .to_le_bytes(),
        );
        if meta.is_dir() {
            stamp(&entry.path(), hash)?;
        }
    }
    Ok(())
}
pub fn legacy(root: &Path) -> Result<Vec<LegacyCache>, String> {
    if !safe_dir(root)? {
        return Ok(Vec::new());
    }
    let mut result = Vec::new();
    for entry in fs::read_dir(root).map_err(err)? {
        let entry = entry.map_err(err)?;
        let id = entry.file_name().to_string_lossy().into_owned();
        if !valid_id(&id) {
            continue;
        }
        safe_dir(&entry.path())?;
        if entry.path().join("owner.json").try_exists().map_err(err)? {
            continue;
        }
        let mut hash = Md5::new();
        stamp(&entry.path(), &mut hash)?;
        result.push(LegacyCache {
            id,
            stamp: format!("{:x}", hash.finalize()),
        });
    }
    result.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(result)
}
pub fn review_legacy(root: &Path, targets: &[LegacyCache]) -> Result<Vec<String>, String> {
    if targets
        .iter()
        .any(|c| !valid_id(&c.id) || !valid_id(&c.stamp))
    {
        return Err("invalid_pdf_cache".into());
    }
    let current = legacy(root)?;
    let mut ids = Vec::new();
    for target in targets {
        if let Some(actual) = current.iter().find(|c| c.id == target.id) {
            if actual.stamp != target.stamp {
                return Err("pdf_cache_changed".into());
            }
            ids.push(target.id.clone());
        } else if root.join(&target.id).try_exists().map_err(err)? {
            return Err("pdf_cache_changed".into());
        }
    }
    Ok(ids)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn sandbox() -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "glossa-pdf-removal-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }
    #[test]
    fn generations_isolate_shared_pdfs_and_survive_restart_without_the_source() {
        let root = sandbox();
        let fingerprint = "a".repeat(32);
        let first = Owner {
            book_id: "first".into(),
            revision: 0,
        };
        let second = Owner {
            book_id: "second".into(),
            revision: 0,
        };
        let a = open(&root, &fingerprint, Some(&first), true)
            .unwrap()
            .unwrap();
        let b = open(&root, &fingerprint, Some(&second), true)
            .unwrap()
            .unwrap();
        assert_ne!(a, b);
        fs::write(root.join(&a).join("outline.json"), "personal").unwrap();
        let ids = block(&root, "first", 200).unwrap();
        assert_eq!(ids, vec![a.clone()]);
        remove(&root, &ids).unwrap();
        assert!(access(&root, &a, Some(&fingerprint)).is_err());
        assert!(open(&root, &fingerprint, Some(&first), true).is_err());
        assert!(root.join(&b).exists());
        let restored = Owner {
            revision: 300,
            ..first
        };
        let next = open(&root, &fingerprint, Some(&restored), true)
            .unwrap()
            .unwrap();
        assert_ne!(a, next);
        assert!(block(&root, "first", 200).is_err());
        assert!(root.join(next).exists());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn legacy_cleanup_requires_an_unchanged_explicit_snapshot_and_preserves_owned_data() {
        let root = sandbox();
        let fingerprint = "b".repeat(32);
        open(&root, &fingerprint, None, true).unwrap();
        fs::write(
            root.join(&fingerprint).join("outline.json"),
            "personal old contents",
        )
        .unwrap();
        let owned = open(
            &root,
            &fingerprint,
            Some(&Owner {
                book_id: "book".into(),
                revision: 0,
            }),
            true,
        )
        .unwrap()
        .unwrap();
        assert_eq!(
            fs::read(root.join(&owned).join("outline.json")).unwrap(),
            b"personal old contents"
        );
        let snapshot = legacy(&root).unwrap();
        assert_eq!(snapshot.len(), 1);
        fs::write(root.join(&fingerprint).join("page.json"), "new data").unwrap();
        assert!(review_legacy(&root, &snapshot).is_err());
        let reviewed = legacy(&root).unwrap();
        remove(&root, &review_legacy(&root, &reviewed).unwrap()).unwrap();
        assert!(root.join(owned).exists());
        assert!(legacy(&root).unwrap().is_empty());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn links_and_path_traversal_are_never_followed() {
        let root = sandbox();
        assert!(block(&root, "../other", 1).is_err());
        assert!(remove(&root, &["../other".into()]).is_err());
        #[cfg(unix)]
        {
            let outside = sandbox();
            std::os::unix::fs::symlink(&outside, root.join("c".repeat(32))).unwrap();
            assert!(legacy(&root).is_err());
            fs::remove_dir_all(outside).unwrap();
        }
        fs::remove_dir_all(root).unwrap();
    }
}

pub fn block_legacy(root: &Path, ids: &[String]) -> Result<(), String> {
    safe_dir(root)?;
    let ledger = root.join("legacy-blocked");
    safe_dir(&ledger)?;
    fs::create_dir_all(&ledger).map_err(err)?;
    for id in ids {
        if !valid_id(id) {
            return Err("invalid_pdf_cache".into());
        }
        let path = ledger.join(format!("{id}.json"));
        if !path.try_exists().map_err(err)? {
            fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(path)
                .map_err(err)?
                .sync_all()
                .map_err(err)?;
        }
    }
    Ok(())
}
