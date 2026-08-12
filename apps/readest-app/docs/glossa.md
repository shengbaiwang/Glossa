# Glossa development scaffold

Glossa is a local, opt-in reader-assistance experiment. The M0 scaffold does
not add an AI provider, API-key handling, retrieval, citations, notes, or UI;
with the flag disabled it has no effect on Readest's startup or reader flow.

## Enable the scaffold locally

Use the standard ignored Next.js local environment file:

```bash
printf '\nNEXT_PUBLIC_GLOSSA_ENABLED=true\n' >> apps/readest-app/.env.local
pnpm tauri dev
```

`NEXT_PUBLIC_GLOSSA_ENABLED=true` is the only enablement value. Omit the line
or use any other value to keep Glossa disabled. Do not add the setting to a
committed environment file or to production configuration.

The sole environment read lives in `src/glossa/featureFlag.ts`; code outside
the module must import `isGlossaEnabled` from `@/glossa` rather than reading
the environment variable itself. The module root will gain `ui`, `context`,
`retrieval`, `ai`, `citations`, and `notes` only as M1+ work introduces real
callers.

## EPUB development fixture

`src/__tests__/fixtures/data/glossa-reading-sample.epub` is a small EPUB 3
fixture made specifically for Glossa. It has three short, titled chapters with
stable English and Chinese paragraphs. The repeated terms **Aster Index**,
**amber mark**, and **shared margin** deliberately create cross-chapter search
and “relate to earlier reading” cases.

It was written from scratch by the Glossa project contributors on 2026-08-13;
it contains no third-party prose, user books, private notes, or personal data.
The fixture and its generated contents are dedicated to the public domain under
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).

Regenerate it without installing any package:

```bash
PATH=/private/tmp/glossa-node-v24.11.1/node-v24.11.1-darwin-arm64/bin:$PATH \
  node apps/readest-app/scripts/generate-glossa-epub-fixture.mjs
```

The script uses macOS's built-in `/usr/bin/zip`, writes the required EPUB
`mimetype` entry first and uncompressed, and fixes source timestamps so the
same toolchain produces a reproducible archive.
