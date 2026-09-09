# Testing

Readest uses three test tiers, all powered by [Vitest](https://vitest.dev/).

## Unit Tests (`pnpm test`)

Runs tests in a **jsdom** environment. No browser or Tauri runtime required.

```bash
pnpm test                                       # Run all unit tests
pnpm test -- src/__tests__/utils/misc.test.ts   # Run a single file
pnpm test -- --watch                            # Watch mode
```

- **Config:** `vitest.config.mts`
- **Pattern:** `src/**/*.test.ts` (excludes `*.browser.test.ts` and `*.tauri.test.ts`)
- **Environment:** jsdom
- **Use for:** Pure logic, utilities, services that don't need real browser APIs or Tauri IPC.

### Native Turso vector precision

The pinned `@tursodatabase/database@0.6.0-pre.28` native binary can use SimSIMD's
serial approximate square root for L2 distance, even with `vector64`. On the tested
macOS arm64 build, `[0,0]` to `[3,4]` returns `4.99704122543335` (relative error
`0.000591755`), and `[0,0]` to `[1,1]` returns `1.414939284324646` (relative error
`0.000513`). Direct SQL reproduces this without changes in `NodeDatabaseService`.
The installed binary's `simsimd_l2_f64_serial` converts the sum to float32 and uses
the fast inverse-square-root constant `0x5f1ffff9` before multiplying by the sum.
SimSIMD describes this optimization in its author's
[discussion of bypassing sqrt](https://ashvardanian.com/posts/simsimd-faster-scipy/).

Only the Node suite therefore opts into a **0.1% relative L2 error budget**. This is
a test acceptance bound for this pinned dependency, not a claim of exact arithmetic
or a precision guarantee for arbitrary vector magnitudes. The shared suite retains
its strict default for WASM and Tauri, and other metrics are unchanged. Assertions
also cover finite/nonnegative results, exact zero, symmetry, actual nearest-neighbor
IDs, and vector32/vector64 at scales `1e-6`, `1`, and `1e6` with signed odd-length
vectors. Do not use a blanket absolute tolerance or round returned database values.
Reassess the Node override when upgrading the native dependency.

## Browser Tests (`pnpm test:browser`)

Runs tests in a **real Chromium** browser via Playwright. Required for code that depends on Web Workers, SharedArrayBuffer, OPFS, or other browser-only APIs.

```bash
pnpm test:browser
```

- **Config:** `vitest.browser.config.mts`
- **Pattern:** `src/**/*.browser.test.ts`
- **Browser:** Chromium (headless, via `@vitest/browser-playwright`)
- **Use for:** WASM modules (e.g. `@tursodatabase/database-wasm`), Web Worker integration, browser-specific storage APIs.

## Tauri Integration Tests (`pnpm test:tauri`)

Runs Vitest tests **inside the Tauri WebView**, with access to Tauri IPC and native plugin commands. Tests execute in the actual app environment.

### Step 1: Start the Tauri App

In one terminal, start the app with the `webdriver` feature enabled:

```bash
pnpm tauri:dev:test     # Dev mode (uses tauri dev server, faster iteration)
pnpm tauri:build:test   # Debug release build (closer to production)
```

These commands compile the Rust backend with `--features webdriver`, which:

- Includes `tauri-plugin-webdriver` (embeds a W3C WebDriver server on port 4445)
- Adds a runtime capability granting plugin permissions to remote URLs (`http://127.0.0.1:*`), so Vitest's browser-mode iframe can call Tauri IPC

Keep this running while you run tests.

### Step 2: Run Tests

In another terminal:

```bash
pnpm test:tauri
```

Vitest connects directly to the embedded WebDriver server (port 4445) in the running Tauri app and executes tests inside its WebView.

- **Config:** `vitest.tauri.config.mts`
- **Pattern:** `src/**/*.tauri.test.ts`
- **Browser provider:** `@vitest/browser-webdriverio` (connects to port 4445)
- **Use for:** Tauri plugin commands (turso, native-tts, etc.), native filesystem, Tauri IPC.

### Writing Tauri Tests

Tests access Tauri IPC via a shared helper:

```typescript
import { invoke } from '../tauri/tauri-invoke';

it('calls a plugin command', async () => {
  const result = await invoke('plugin:turso|load', { options: { path: 'sqlite::memory:' } });
  expect(result).toBeDefined();
});
```

The `invoke()` helper accesses `window.top.__TAURI_INTERNALS__` (Vitest runs in an iframe, Tauri injects IPC into the main frame).

**Limitations:** Only custom invoke commands and plugin commands listed in the webdriver capability work. Standard Tauri JS APIs (e.g. `@tauri-apps/api`) that rely on `URL: local` may not work from the Vitest iframe.

## Android Device E2E (`pnpm test:android`)

Drives the **installed Readest app** on an adb-connected Android device or
emulator: gestures are injected with `adb shell input`, and the app's state is
probed through the WebView's **Chrome DevTools Protocol** (forwarded from the
`webview_devtools_remote_<pid>` abstract socket). This is the only lane that
exercises real Android touch selection, native handle behavior, and page-turn
gestures (e.g. the issue #1553 hyphen-selection fixes).

```bash
# One-time: install a dev build on the device/emulator
pnpm dev-android

# Start an emulator if no device is attached (see `emulator -list-avds`)
emulator -avd Pixel_9_Pro &

# Run the lane (soft-skips when no adb/device/app is available)
pnpm test:android

# With several devices attached, pick one:
ANDROID_SERIAL=emulator-5554 pnpm test:android
```

- **Config:** `vitest.android.config.mts` (node environment, serial execution, `retry: 1`)
- **Pattern:** `src/**/*.android.test.ts`
- **Helpers:** `src/__tests__/android/helpers/` — `adb.ts` (gestures), `cdp.ts` (DevTools client), `reader.ts` (app-level probes)
- **Fixtures:** plain EPUBs from `src/__tests__/fixtures/data/` (e.g. `sample-alice.epub`), opened transiently via a `VIEW` intent so the device library is never modified
- **Use for:** native text selection, touch gestures, selection handles, anything that only reproduces in the Android WebView compositor.

### Conventions

- **Probe, don't hardcode:** locate words/handles at runtime via CDP and derive
  device pixels from `devicePixelRatio` — never bake in coordinates.
- **Poll, don't sleep:** use `waitFor()` on an observable condition (selection
  state, handle count, frame position); reserve fixed pauses for gesture
  pacing (long-press hold, corner dwell).
- **Discover, don't assume:** the harness finds a hyphenated on-screen
  paragraph at runtime and derives every gesture target from live layout, so
  any English fixture works regardless of fonts or screen size (hyphenation
  is on by default in the app).
- **Serial only:** one device, one app — the config disables parallelism.

### CI

`.github/workflows/android-e2e.yml` runs the lane on an x86_64 emulator
(ubuntu runner with KVM): it builds a **debug** APK for `x86_64` (no signing
secrets needed), boots a cached AVD via `reactivecircus/android-emulator-runner`,
installs the APK, and runs `pnpm test:android`. It is intentionally not
PR-blocking — it runs nightly, on `workflow_dispatch`, or when a PR gets the
`e2e-android` label.

## E2E Tests (WDIO)

Full end-to-end tests using WebDriverIO, for UI-level testing against the running Tauri app. Same two-step workflow as Tauri integration tests.

```bash
# Terminal 1: start the app (same as for Tauri integration tests)
pnpm tauri:dev:test

# Terminal 2: run E2E tests
pnpm test:e2e
```

- **Config:** `wdio.conf.ts`
- **Pattern:** `e2e/**/*.e2e.ts`
- **Framework:** Mocha (via `@wdio/mocha-framework`)
- **Connects to:** port 4445 (embedded WebDriver server)
- **Use for:** UI interaction tests, window management, navigation flows.

## Test File Naming

| Suffix              | Runner              | Environment           |
| ------------------- | ------------------- | --------------------- |
| `*.test.ts`         | `pnpm test`         | jsdom                 |
| `*.browser.test.ts` | `pnpm test:browser` | Chromium (Playwright) |
| `*.tauri.test.ts`   | `pnpm test:tauri`   | Tauri WebView         |
| `*.e2e.ts`          | `pnpm test:e2e`     | Tauri app (WDIO)      |
| `*.android.test.ts` | `pnpm test:android` | Android device (CDP)  |
