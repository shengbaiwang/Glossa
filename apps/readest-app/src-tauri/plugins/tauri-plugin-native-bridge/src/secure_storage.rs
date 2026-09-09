//! Desktop credentials use the app's own brand and runtime scope. Legacy
//! credentials are copied on demand, never renamed or deleted in place.
use keyring_core::{Entry, Error, Result};
use std::sync::{Mutex, MutexGuard};

const LEGACY_SERVICE: &str = "Readest Safe Storage";
pub(crate) const SYNC_ACCOUNT: &str = "default";

// IPC creates separate handles and can run them concurrently. Hold one shared
// transaction lock across legacy reads and the copy so a delayed keychain
// prompt cannot overwrite a newer value or resurrect a cleared credential.
static STORAGE_TRANSACTION: Mutex<()> = Mutex::new(());

fn lock_storage() -> Result<MutexGuard<'static, ()>> {
    STORAGE_TRANSACTION.lock().map_err(|_| {
        Error::PlatformFailure(Box::new(std::io::Error::other(
            "A secure storage operation was interrupted",
        )))
    })
}

fn service_name(identifier: &str) -> String {
    match identifier {
        "app.glossa.reader" => "Glossa Safe Storage".into(),
        "app.glossa.reader.dev" => "Glossa Dev Safe Storage".into(),
        other => format!("Glossa Safe Storage ({other})"),
    }
}

pub(crate) trait SecretStore {
    fn read(&self, service: &str, account: &str) -> Result<Vec<u8>>;
    fn write(&self, service: &str, account: &str, value: &[u8]) -> Result<()>;
}

pub(crate) struct SystemStore;

impl SecretStore for SystemStore {
    fn read(&self, service: &str, account: &str) -> Result<Vec<u8>> {
        Entry::new(service, account)?.get_secret()
    }

    fn write(&self, service: &str, account: &str, value: &[u8]) -> Result<()> {
        Entry::new(service, account)?.set_secret(value)
    }
}

pub(crate) struct SecureStorage<S = SystemStore> {
    service: String,
    store: S,
}

impl SecureStorage {
    pub(crate) fn for_app(identifier: &str) -> Self {
        Self {
            service: service_name(identifier),
            store: SystemStore,
        }
    }

    pub(crate) fn probe(&self) -> Result<()> {
        // Constructing a handle does not retrieve a user's credential.
        Entry::new(&self.service, SYNC_ACCOUNT).map(|_| ())
    }
}

impl<S: SecretStore> SecureStorage<S> {
    pub(crate) fn get(&self, account: &str) -> Result<String> {
        let _transaction = lock_storage()?;
        match self.store.read(&self.service, account) {
            // This envelope exists only in the new Glossa service. A cleared
            // marker contains no secret and prevents legacy-value resurrection.
            Ok(value) => match value.as_slice() {
                [0] => Err(Error::NoEntry),
                [1, secret @ ..] => String::from_utf8(secret.to_vec()).map_err(|_| {
                    Error::BadStoreFormat("Invalid Glossa credential encoding".into())
                }),
                _ => Err(Error::BadStoreFormat(
                    "Invalid Glossa credential record".into(),
                )),
            },
            Err(Error::NoEntry) => {
                let legacy = self.store.read(LEGACY_SERVICE, account)?;
                let value = String::from_utf8(legacy).map_err(|_| {
                    Error::BadStoreFormat("Invalid legacy credential encoding".into())
                })?;
                // A refused/failed copy is an error, not a missing credential.
                self.write_value(account, &value)?;
                Ok(value)
            }
            // Access denial must not trigger a read from a different service.
            Err(error) => Err(error),
        }
    }

    pub(crate) fn set(&self, account: &str, value: &str) -> Result<()> {
        let _transaction = lock_storage()?;
        self.write_value(account, value)
    }

    // Caller already holds STORAGE_TRANSACTION, including migration in get().
    fn write_value(&self, account: &str, value: &str) -> Result<()> {
        let mut record = Vec::with_capacity(value.len() + 1);
        record.push(1);
        record.extend_from_slice(value.as_bytes());
        self.store.write(&self.service, account, &record)
    }

    pub(crate) fn clear(&self, account: &str) -> Result<()> {
        let _transaction = lock_storage()?;
        // Do not delete a legacy entry another installed app may still use.
        self.store.write(&self.service, account, &[0])
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::{Cell, RefCell};
    use std::collections::HashMap;
    use std::sync::{mpsc, Arc, Mutex};
    use std::time::Duration;

    #[derive(Default)]
    struct MemoryStore {
        entries: RefCell<HashMap<(String, String), Vec<u8>>>,
        reads: RefCell<Vec<(String, String)>>,
        deny_service: RefCell<Option<String>>,
        fail_write: Cell<bool>,
    }

    impl SecretStore for MemoryStore {
        fn read(&self, service: &str, account: &str) -> Result<Vec<u8>> {
            self.reads
                .borrow_mut()
                .push((service.into(), account.into()));
            if self.deny_service.borrow().as_deref() == Some(service) {
                return Err(Error::NoStorageAccess(Box::new(std::io::Error::from(
                    std::io::ErrorKind::PermissionDenied,
                ))));
            }
            self.entries
                .borrow()
                .get(&(service.into(), account.into()))
                .cloned()
                .ok_or(Error::NoEntry)
        }

        fn write(&self, service: &str, account: &str, value: &[u8]) -> Result<()> {
            if self.fail_write.get() {
                return Err(Error::NoDefaultStore);
            }
            self.entries
                .borrow_mut()
                .insert((service.into(), account.into()), value.to_vec());
            Ok(())
        }
    }

    fn storage() -> SecureStorage<MemoryStore> {
        SecureStorage {
            service: service_name("app.glossa.reader"),
            store: MemoryStore::default(),
        }
    }

    #[test]
    fn credentials_use_glossa_branding_and_runtime_isolation() {
        assert_eq!(service_name("app.glossa.reader"), "Glossa Safe Storage");
        assert_eq!(
            service_name("app.glossa.reader.dev"),
            "Glossa Dev Safe Storage"
        );
        assert_ne!(service_name("test.one"), service_name("test.two"));
        assert_ne!(service_name("test.one"), service_name("app.glossa.reader"));
    }

    #[test]
    fn copies_legacy_once_without_changing_the_original() {
        let storage = storage();
        storage
            .store
            .write(LEGACY_SERVICE, SYNC_ACCOUNT, b"legacy-passphrase")
            .unwrap();
        assert_eq!(storage.get(SYNC_ACCOUNT).unwrap(), "legacy-passphrase");
        assert_eq!(
            storage.store.entries.borrow()[&(LEGACY_SERVICE.into(), SYNC_ACCOUNT.into())],
            b"legacy-passphrase"
        );
        storage
            .store
            .deny_service
            .replace(Some(LEGACY_SERVICE.into()));
        assert_eq!(storage.get(SYNC_ACCOUNT).unwrap(), "legacy-passphrase");
        assert_eq!(storage.store.reads.borrow().len(), 3);
    }

    #[test]
    fn set_and_get_preserve_empty_unicode_and_independent_accounts() {
        let storage = storage();
        storage.set(SYNC_ACCOUNT, "同步密码 🔑").unwrap();
        storage.set("model-service", "").unwrap();
        assert_eq!(storage.get(SYNC_ACCOUNT).unwrap(), "同步密码 🔑");
        assert_eq!(storage.get("model-service").unwrap(), "");
        assert!(storage
            .store
            .reads
            .borrow()
            .iter()
            .all(|(service, _)| service != LEGACY_SERVICE));
    }

    #[test]
    fn clear_does_not_resurrect_or_delete_legacy_and_can_be_replaced() {
        let storage = storage();
        storage
            .store
            .write(LEGACY_SERVICE, "provider", b"old")
            .unwrap();
        storage.set("provider", "new").unwrap();
        storage.clear("provider").unwrap();
        storage.clear("provider").unwrap();
        storage
            .store
            .deny_service
            .replace(Some(LEGACY_SERVICE.into()));
        assert!(matches!(storage.get("provider"), Err(Error::NoEntry)));
        assert_eq!(
            storage.store.entries.borrow()[&(LEGACY_SERVICE.into(), "provider".into())],
            b"old"
        );
        storage.set("provider", "replacement").unwrap();
        assert_eq!(storage.get("provider").unwrap(), "replacement");
    }

    #[test]
    fn clearing_unmigrated_key_does_not_read_legacy() {
        let storage = storage();
        storage
            .store
            .deny_service
            .replace(Some(LEGACY_SERVICE.into()));
        storage.clear("provider").unwrap();
        assert!(matches!(storage.get("provider"), Err(Error::NoEntry)));
        assert_eq!(storage.store.reads.borrow().len(), 1);
    }

    #[test]
    fn denied_current_access_never_falls_back() {
        let storage = storage();
        storage
            .store
            .write(LEGACY_SERVICE, "provider", b"old")
            .unwrap();
        storage
            .store
            .deny_service
            .replace(Some(storage.service.clone()));
        assert!(matches!(
            storage.get("provider"),
            Err(Error::NoStorageAccess(_))
        ));
        assert_eq!(storage.store.reads.borrow().len(), 1);
    }

    #[test]
    fn denied_legacy_access_is_not_reported_as_missing() {
        let storage = storage();
        storage
            .store
            .deny_service
            .replace(Some(LEGACY_SERVICE.into()));
        assert!(matches!(
            storage.get("provider"),
            Err(Error::NoStorageAccess(_))
        ));
        assert!(storage.store.entries.borrow().is_empty());
    }

    #[test]
    fn failed_copy_keeps_legacy_and_can_retry() {
        let storage = storage();
        storage
            .store
            .write(LEGACY_SERVICE, "provider", b"old")
            .unwrap();
        storage.store.fail_write.set(true);
        assert!(matches!(
            storage.get("provider"),
            Err(Error::NoDefaultStore)
        ));
        assert_eq!(storage.store.entries.borrow().len(), 1);
        storage.store.fail_write.set(false);
        assert_eq!(storage.get("provider").unwrap(), "old");
    }

    #[test]
    fn failed_clear_is_reported_and_preserves_current_value() {
        let storage = storage();
        storage.set("provider", "current").unwrap();
        storage.store.fail_write.set(true);
        assert!(matches!(
            storage.clear("provider"),
            Err(Error::NoDefaultStore)
        ));
        assert_eq!(storage.get("provider").unwrap(), "current");
    }

    #[test]
    fn missing_or_invalid_credentials_do_not_create_or_revive_values() {
        let storage = storage();
        assert!(matches!(storage.get("missing"), Err(Error::NoEntry)));
        assert!(storage.store.entries.borrow().is_empty());
        storage
            .store
            .write(LEGACY_SERVICE, "provider", b"old")
            .unwrap();
        for invalid in [vec![], vec![0, 1], vec![2], vec![1, 0xff]] {
            storage
                .store
                .write(&storage.service, "provider", &invalid)
                .unwrap();
            assert!(matches!(
                storage.get("provider"),
                Err(Error::BadStoreFormat(_))
            ));
        }
        storage
            .store
            .write(LEGACY_SERVICE, "bad-legacy", &[0xff])
            .unwrap();
        assert!(matches!(
            storage.get("bad-legacy"),
            Err(Error::BadStoreFormat(_))
        ));
    }

    struct BlockingStore {
        entries: Mutex<HashMap<(String, String), Vec<u8>>>,
        legacy_read_started: mpsc::Sender<()>,
        resume_legacy_read: Mutex<mpsc::Receiver<()>>,
    }

    impl SecretStore for Arc<BlockingStore> {
        fn read(&self, service: &str, account: &str) -> Result<Vec<u8>> {
            if service == LEGACY_SERVICE {
                self.legacy_read_started.send(()).unwrap();
                self.resume_legacy_read
                    .lock()
                    .unwrap()
                    .recv_timeout(Duration::from_secs(5))
                    .map_err(|error| Error::PlatformFailure(Box::new(error)))?;
            }
            self.entries
                .lock()
                .unwrap()
                .get(&(service.into(), account.into()))
                .cloned()
                .ok_or(Error::NoEntry)
        }

        fn write(&self, service: &str, account: &str, value: &[u8]) -> Result<()> {
            self.entries
                .lock()
                .unwrap()
                .insert((service.into(), account.into()), value.to_vec());
            Ok(())
        }
    }

    fn migration_and_mutation_are_serialized(replacement: Option<&str>) {
        let (legacy_started_tx, legacy_started_rx) = mpsc::channel();
        let (resume_tx, resume_rx) = mpsc::channel();
        let store = Arc::new(BlockingStore {
            entries: Mutex::new(HashMap::new()),
            legacy_read_started: legacy_started_tx,
            resume_legacy_read: Mutex::new(resume_rx),
        });
        store.write(LEGACY_SERVICE, "provider", b"legacy").unwrap();
        // Desktop IPC constructs a fresh storage handle per call. The lock
        // must therefore cover separate handles sharing the same keychain.
        let migrating = SecureStorage {
            service: service_name("app.glossa.reader"),
            store: Arc::clone(&store),
        };
        let mutating = SecureStorage {
            service: service_name("app.glossa.reader"),
            store: Arc::clone(&store),
        };
        std::thread::scope(|scope| {
            let migration = scope.spawn(|| migrating.get("provider"));
            legacy_started_rx
                .recv_timeout(Duration::from_secs(5))
                .unwrap();
            let (mutation_started_tx, mutation_started_rx) = mpsc::channel();
            let (mutation_done_tx, mutation_done_rx) = mpsc::channel();
            let mutation = scope.spawn(move || {
                mutation_started_tx.send(()).unwrap();
                let result = match replacement {
                    Some(value) => mutating.set("provider", value),
                    None => mutating.clear("provider"),
                };
                mutation_done_tx.send(()).unwrap();
                result
            });
            mutation_started_rx
                .recv_timeout(Duration::from_secs(5))
                .unwrap();
            let mutation_overlapped = mutation_done_rx
                .recv_timeout(Duration::from_millis(100))
                .is_ok();
            // Always release the fake keychain before asserting or joining.
            resume_tx.send(()).unwrap();
            assert_eq!(migration.join().unwrap().unwrap(), "legacy");
            mutation.join().unwrap().unwrap();
            assert!(!mutation_overlapped, "mutation raced with legacy migration");
        });
        match replacement {
            Some(value) => assert_eq!(migrating.get("provider").unwrap(), value),
            None => assert!(matches!(migrating.get("provider"), Err(Error::NoEntry))),
        }
        assert_eq!(
            store.entries.lock().unwrap()[&(LEGACY_SERVICE.into(), "provider".into())],
            b"legacy"
        );
    }

    #[test]
    fn concurrent_clear_cannot_be_overwritten_by_legacy_migration() {
        migration_and_mutation_are_serialized(None);
    }

    #[test]
    fn concurrent_set_cannot_be_overwritten_by_legacy_migration() {
        migration_and_mutation_are_serialized(Some("replacement"));
    }
}
