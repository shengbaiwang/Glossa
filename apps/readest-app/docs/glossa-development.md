# Glossa development runtime

Glossa runs on the Readest source base during validation, but its development
runtime must never share the installed Readest application's identity or data.

## Start it

From the repository root, run:

```bash
pnpm dev:glossa
```

To open the project's original EPUB fixture on launch:

```bash
pnpm dev:glossa -- apps/readest-app/src/__tests__/fixtures/data/glossa-reading-sample.epub
```

Use `pnpm dev:glossa:check` to confirm that Node 24, Cargo and the isolated
configuration are available without starting the application.

The launcher selects Homebrew Node 24 and Rust when they are installed, sets
the isolated runtime identifier, disables the upstream updater and writes Rust output
only under `.glossa-dev/target/`. It refuses portable mode because a Tauri dev
binary and the portable data directory would otherwise both be named `Readest`.

## Build the local macOS app

From the repository root, run:

```bash
pnpm build:glossa:macos
```

The command uses the isolated production identity `app.glossa.reader`, sets
that identity at frontend build time, uses the Webpack path required by the current
static reader export, and creates an ad-hoc-signed local app at
`.glossa-build/target/release/bundle/macos/Glossa.app`. It does not upload
source maps or create updater artifacts. The app uses the generated Glossa icon
under `src-tauri/icons/glossa/` and cannot use Readest's upstream update feed.

This local ad-hoc signature is intended for the current Mac. Public
distribution would require a separate signing/notarization and AGPL review.

## Identity boundaries

| Runtime | Identifier | Application data on macOS | Build output |
| --- | --- | --- | --- |
| Installed Readest | `com.bilingify.readest` | `~/Library/Application Support/com.bilingify.readest` | not in this repository |
| Glossa Dev | `app.glossa.reader.dev` | `~/Library/Application Support/app.glossa.reader.dev` | `.glossa-dev/target/` |
| Local Glossa app | `app.glossa.reader` | `~/Library/Application Support/app.glossa.reader` | `.glossa-build/target/` |

`apps/readest-app/src-tauri/tauri.glossa-dev.conf.json` is the development-only
overlay. It supplies the separate product name, executable name, identifier and
`glossa-dev://` deep-link scheme, and disables bundle creation. The local
Release app instead uses `tauri.glossa.conf.json` and `glossa://`.

When `NEXT_PUBLIC_GLOSSA_RUNTIME_ID` is set, `NativeAppService` checks the runtime identifier before preparing the books directory or writing settings. Use the launcher so the build and native identifiers match. Do not set `NEXT_PUBLIC_PORTABLE_APP` for Glossa.

## What remains shared intentionally

The repository and the Readest source code remain shared so upstream changes
can be merged without maintaining a forked reader engine. Glossa now retains basic reading and cloud sync. The former `src/glossa/` AI module has been removed; the runtime identity guard lives in `src/services/glossaRuntime.ts`.

Never copy an old project's `.env` files, local database, book library or API
keys into this repository. Existing operating-system keychain items and application data are not deleted by this source cleanup.
