# Dependency patches

## @tauri-apps/plugin-http 2.5.9

The ESM and CommonJS entries share a response lifecycle fix. Rust releases the
response resource at EOF before the EOF IPC result reaches JavaScript. Cancelling
the JS reader during that interval used to float an invalid-resource rejection;
the plugin also retained abort listeners after requests and bodies had settled.

The patch detaches settled listeners, releases each body at most once from JS,
discards reads that complete after cancellation, and returns the cleanup promise
to reader.cancel(). Only the exact already-released response resource error is
treated as successful cleanup. Other cleanup failures remain observable by the
cancel caller; abort/read failures retain their primary error. A late response
after request cancellation, and responses with no JS body, are also released.

This does not change URLs, headers, credentials, native permissions, or the Rust
transport. The version remains pinned by pnpm-lock.yaml. Both published JS entries
must be patched; retain the upstream license files. Recheck and remove this patch
when upgrading to an upstream version with equivalent lifecycle handling.

Regression coverage:

- `tauriHttpLifecycle.test.ts` executes the installed ESM/CommonJS plugin in child
  processes with synthetic IPC, asserting that no unhandled rejection escapes.
- `providerNativeLifecycle.test.ts` exercises the actual provider and plugin for
  completed chat, cancellation, and sequential tool responses. Only IPC is mocked;
  no model service or network is contacted.
