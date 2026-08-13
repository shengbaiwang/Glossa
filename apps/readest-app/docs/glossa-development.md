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
the Glossa feature flag, disables the upstream updater and writes Rust output
only under `.glossa-dev/target/`. It refuses portable mode because a Tauri dev
binary and the portable data directory would otherwise both be named `Readest`.

## Identity boundaries

| Runtime | Identifier | Application data on macOS | Build output |
| --- | --- | --- | --- |
| Installed Readest | `com.bilingify.readest` | `~/Library/Application Support/com.bilingify.readest` | not in this repository |
| Glossa Dev | `app.glossa.reader.dev` | `~/Library/Application Support/app.glossa.reader.dev` | `.glossa-dev/target/` |

`apps/readest-app/src-tauri/tauri.glossa-dev.conf.json` is the only Tauri
overlay for Glossa Dev. It supplies the separate product name, executable name,
identifier and `glossa-dev://` deep-link scheme. It disables bundle creation;
it is for local development only.

When Glossa is enabled, `NativeAppService` checks the runtime identifier before
it prepares the books directory or writes settings. A command such as
`NEXT_PUBLIC_GLOSSA_ENABLED=true pnpm tauri dev` therefore fails safely instead
of using Readest's identity. Do not set `NEXT_PUBLIC_PORTABLE_APP` for Glossa.

## What remains shared intentionally

The repository and the Readest source code remain shared so upstream changes
can be merged without maintaining a forked reader engine. Glossa product code
lives under `apps/readest-app/src/glossa/`; integration points outside that
directory should remain narrow and documented.

Never copy an old project's `.env` files, local database, book library or API
keys into this repository. The DeepSeek key is held in the operating-system
keychain and is not a project file.
