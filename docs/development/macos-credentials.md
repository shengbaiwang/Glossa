# macOS signing and model credentials

Glossa's packaged macOS build and `pnpm dev:glossa` use a persistent signing identity and a fixed, native credential helper. Production (`app.glossa.reader`) and Dev (`app.glossa.reader.dev`) keep separate credentials and application data.

## Why signing alone is insufficient

Ad-hoc signatures identify a build by its code hash. Rebuilding the app can make macOS ask for Keychain authorization again. A persistent self-signed certificate gives the app a stable designated requirement, but current macOS also applies Keychain partitions. Apple securityd assigns self-signed code a code-hash partition, so a second build can still fail a noninteractive read even with the same certificate, identifier, and executable path. This was reproduced with synthetic records on this Mac; changing the designated requirement alone is not the fix.

The helper stays at `~/Library/Application Support/Glossa Signing/credential-helper` and is reused byte-for-byte across app builds. The app pins its certificate and code-directory hash and verifies the running helper before sending credentials over private stdin. The helper verifies the parent's certificate, exact identifier, UID, PID/start time, and dynamic signature before and after receiving a request. Both use Hardened Runtime; the helper rejects callers that lack it or permit injection/debugging. A failed identity check does not fall back to unprotected storage.

The helper maps verified identities to `Glossa Credentials v2` or `Glossa Dev Credentials v2`. Earlier `Glossa Safe Storage` / `Glossa Dev Safe Storage` records are read only and migrated after a successful read; only production may read the older `Readest Safe Storage`. Old records are preserved. New records belong to the fixed helper, so a user who grants the one-time migration read does not have to permanently expand an old item's access list. A cleared record leaves a tombstone to prevent an old key from reappearing.

Status queries request attributes only, disable authentication UI, and distinguish missing from unavailable. Opening model settings should not decrypt a key. Actual model use, saving a key, the first authorized migration, unlocking a locked Keychain, or upgrading the helper can still require legitimate system authorization.

## Local identity and builds

For a personal installation without Developer ID:

```sh
node scripts/glossa-macos-signing.mjs provision
node scripts/glossa-macos-signing.mjs provision-helper
pnpm build:glossa:macos
```

The identity's private key is stored only in the user's Keychain; public identity metadata and the helper are in the private App Support directory, outside Git. Temporary PKCS#12/private-key files are deleted after import. No system-wide certificate trust or Keychain partition change is made. No fallback to ad-hoc signing is allowed.

Local signing requires explicit private-key authorization. Choose **Allow**, not **Always Allow**, when signing. Permanently trusting `/usr/bin/codesign` would let another process owned by the same user sign an impostor app that the helper accepts. Provisioning therefore creates an empty trusted-app list for restricted private-key operations. To audit or tighten this one provisioned identity:

```sh
node scripts/glossa-macos-signing.mjs inspect-private-key
node scripts/glossa-macos-signing.mjs lock-private-key
```

The tightening tool identifies the certificate exactly, changes only its private key's sensitive ACL app lists, preserves authorizations and partition entries, verifies the saved lists are empty, and checks that a native signing attempt with interaction disabled is rejected. It does not modify other identities. It cannot stop a user from choosing Always Allow in a later system prompt; repeat the inspection after changing signing permissions.

For an externally provisioned Developer ID, set `GLOSSA_MACOS_SIGNING_IDENTITY` to its exact certificate name or SHA-1 fingerprint, and optionally `GLOSSA_MACOS_SIGNING_KEYCHAIN`. Changing signer also requires an explicit helper upgrade. Developer ID alone is not a promise of notarization or public distribution readiness.

The build pins `GLOSSA_SIGNING_FINGERPRINT` in Rust, lets Tauri sign the bundle from the inside out, and verifies its final certificate, identifier, stable requirement, Hardened Runtime, and absence of injection/debug entitlements. Dev uses Cargo's target runner to sign its isolated executable before execution; its normal watcher and arguments remain intact.

## Helper upgrades and acceptance

Ordinary builds refuse to silently replace a helper whose source or signing policy changed. Review the change and explicitly run:

```sh
node scripts/glossa-macos-signing.mjs upgrade-helper
```

A helper upgrade changes its own code hash and can require a fresh Keychain authorization. The prior helper executable is retained locally for diagnosis; it is not selected automatically. Do not rebuild the helper on each app installation.

`node scripts/verify-glossa-credential-helper.mjs` compiles two different signed native callers, replaces one at the same path, and tests noninteractive Keychain access, production/Dev separation, metadata, tombstones, identity/runtime rejection, request limits, and fixture cleanup. Callers accept only synthetic account prefixes, and their signatures are removed after testing. The old-app fixture proves an existing item is not silently granted to the helper and that a record supplied by its existing owner can be stored in v2 and reused across caller versions. It does **not** automate a real user's one-time authorization dialog. `node scripts/verify-glossa-dev-signing.mjs` checks Cargo's real target runner with a small isolated Rust fixture without restarting Dev. Evidence is under ignored `.glossa-dev/qa/`; no real model key is read or logged.

`node scripts/verify-glossa-macos-signing.mjs` is the earlier direct-Keychain diagnostic. With a self-signed identity, a second build is expected to fail on current macOS; this distinguishes stable signing identity from actual Keychain continuity.

References: [Apple TN2206](https://developer.apple.com/library/archive/technotes/tn2206/_index.html), [Apple securityd partition implementation](https://github.com/apple-oss-distributions/Security/blob/main/securityd/src/clientid.cpp), [Keychain access control lists](https://developer.apple.com/documentation/security/access-control-lists), [SecAccessCreate](https://developer.apple.com/documentation/security/secaccesscreate(_:_:_:)), [SecACLSetContents](https://developer.apple.com/documentation/security/secaclsetcontents(_:_:_:_:)), [Tauri 2.11.4 Cargo dev runner](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.11.4/crates/tauri-cli/src/interface/rust/desktop.rs).
