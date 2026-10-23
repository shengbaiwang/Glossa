import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { it, vi, expect } from 'vitest';
import { z } from 'zod';
import { DocumentLoader } from '@/libs/document';
import { preparePDFContents, type PDFContentsReport } from '@/services/pdfAutoContents';
import { outlineEntrySchema, type PDFCache } from '@/services/pdfEnhancement';
import { evaluateContents, classifyFailure } from './metrics';

const fixtureSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,60}$/),
  source: z.string().min(1),
  md5: z.string().regex(/^[a-f0-9]{32}$/),
  pages: z.number().int().positive(),
  expected: z.array(outlineEntrySchema).max(128),
  audited: z.boolean(),
  review: z.string().max(1000),
  history: z.array(
    z.enum([
      'discovery',
      'recognition',
      'mapping',
      'timeout',
      'runtime',
      'extraction',
      'verification',
    ]),
  ),
});
const manifestSchema = z.object({
  version: z.literal(1),
  helper: z.string().min(1),
  output: z.string().min(1),
  fixtures: z.array(fixtureSchema).min(1).max(32),
});
const state = vi.hoisted(() => ({
  directory: '',
  helper: '',
  cache: { id: '', pages: [], outline: null, revision: 0 } as PDFCache,
  calls: [] as { mode: string; indices: number[]; elapsedMs: number }[],
}));
vi.mock('@/glossa/harness/derivedStore', async () => {
  const { createHash } = await import('node:crypto');
  const { readFile, writeFile } = await import('node:fs/promises');
  return {
    hashData: async (value: unknown) =>
      createHash('sha256').update(JSON.stringify(value)).digest('hex'),
    createDerivedStore: (_database: string, schema: z.ZodType) => ({
      load: async (key: string) => {
        try {
          return schema.parse(
            JSON.parse(await readFile(`${state.directory}/checkpoint-${key}.json`, 'utf8')),
          );
        } catch {
          return null;
        }
      },
      save: async (key: string, value: unknown, signal: AbortSignal) => {
        signal.throwIfAborted();
        await writeFile(
          `${state.directory}/checkpoint-${key}.json`,
          JSON.stringify(schema.parse(value)),
          { mode: 0o600 },
        );
      },
    }),
  };
});
vi.mock('@/services/pdfEnhancement', async (original) => {
  const actual = await original<typeof import('@/services/pdfEnhancement')>();
  return {
    ...actual,
    openPDFCache: async () => structuredClone(state.cache),
    readOCRPage: async (
      _id: string,
      index: number,
      detect = false,
      contents = false,
      heading = false,
    ) => {
      try {
        return actual.parseOCRPage(
          JSON.parse(
            await readFile(
              path.join(
                state.directory,
                heading
                  ? 'vision-heading-1'
                  : contents
                    ? 'vision-contents-1'
                    : detect
                      ? 'vision-detect-1'
                      : 'vision-pdf-1',
                `page-${index}.json`,
              ),
              'utf8',
            ),
          ),
          index,
        );
      } catch {
        return null;
      }
    },
    savePDFOutline: async (
      _source: string,
      cache: PDFCache,
      outline: PDFCache['outline'],
      _count: number,
      generator: string,
    ) => {
      if (cache.revision !== state.cache.revision) throw new Error('outline_changed');
      state.cache = { ...state.cache, outline, generator, revision: cache.revision + 1 };
      await writeFile(`${state.directory}/outline.json`, JSON.stringify(state.cache), {
        mode: 0o600,
      });
      return structuredClone(state.cache);
    },
  };
});
vi.mock('@/services/pdfOCR', () => ({
  recognizePDFPages: async (
    source: string,
    _id: string,
    indices: number[],
    signal: AbortSignal,
    _onStatus: unknown,
    detect = false,
    contents = false,
    heading = false,
  ) => {
    const directory = path.join(
      state.directory,
      heading
        ? 'vision-heading-1'
        : contents
          ? 'vision-contents-1'
          : detect
            ? 'vision-detect-1'
            : 'vision-pdf-1',
    );
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const start = performance.now();
    try {
      await promisify(execFile)(
        state.helper,
        [
          ...(heading ? ['--heading'] : contents ? ['--contents'] : detect ? ['--detect'] : []),
          source,
          directory,
          indices.join(','),
        ],
        { signal, timeout: 180_000 },
      );
    } finally {
      state.calls.push({
        mode: heading ? 'heading' : contents ? 'contents' : detect ? 'detection' : 'precise',
        indices,
        elapsedMs: Math.round(performance.now() - start),
      });
    }
    return { state: 'completed', completed: indices.length, total: indices.length, error: null };
  },
}));

const manifestPath = process.env['GLOSSA_PDF_CONTENTS_CORPUS'];
if (!manifestPath)
  throw new Error('Set GLOSSA_PDF_CONTENTS_CORPUS to a private, audited corpus manifest.');
const manifest = manifestSchema.parse(JSON.parse(await readFile(manifestPath, 'utf8')));
const provenance = Object.fromEntries(
  await Promise.all(
    [
      ['algorithm', path.resolve('src/services/pdfAutoContents.ts')],
      ['adapter', path.resolve('../../packages/foliate-js/pdf.js')],
      ['native', path.resolve('src-tauri/src/macos/pdf_ocr.swift')],
      ['helper', manifest.helper],
    ].map(async ([name, source]) => [
      name,
      createHash('sha256')
        .update(await readFile(source!))
        .digest('hex'),
    ]),
  ),
);
const { default: initVariants } = await import('@simplecc/simplecc_wasm');
await initVariants({
  module_or_path: await readFile('public/vendor/simplecc/simplecc_wasm_bg.wasm'),
});
const mode = process.env['GLOSSA_PDF_CONTENTS_MODE'] ?? 'cold';
if (!['cold', 'resume'].includes(mode)) throw new Error('Evaluation mode must be cold or resume.');
const runID = process.env['GLOSSA_PDF_CONTENTS_RUN'] ?? `${Date.now()}`;
if (!/^[a-zA-Z0-9-]{1,80}$/.test(runID)) throw new Error('Invalid evaluation run id');
await mkdir(manifest.output, { recursive: true, mode: 0o700 });
const results: unknown[] = [];
for (const fixture of manifest.fixtures) {
  it(`evaluates real material ${fixture.id} (${mode})`, async () => {
    const source = await realpath(fixture.source);
    const output = await realpath(manifest.output);
    // The harness can write only its explicit isolated output directory.
    if (source.startsWith(`${output}${path.sep}`))
      throw new Error('Source must be outside evaluation output.');
    if (output === path.dirname(source) || output.startsWith(`${path.dirname(source)}${path.sep}`))
      throw new Error('Evaluation output must be outside the source directory.');
    state.directory = path.join(output, runID, fixture.id);
    if (mode === 'cold') {
      try {
        await mkdir(state.directory, { recursive: false, mode: 0o700 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
          throw new Error('Cold evaluation requires a new directory.');
        await mkdir(path.dirname(state.directory), { recursive: true, mode: 0o700 });
        await mkdir(state.directory, { mode: 0o700 });
      }
    } else await mkdir(state.directory, { recursive: true, mode: 0o700 });
    state.helper = manifest.helper;
    state.calls = [];
    const bytes = await readFile(source);
    const md5 = createHash('md5').update(bytes).digest('hex');
    expect(md5).toBe(fixture.md5);
    let saved: PDFCache | undefined;
    if (mode === 'resume') {
      try {
        saved = z
          .object({
            id: z.literal(md5),
            pages: z
              .array(
                z
                  .number()
                  .int()
                  .min(0)
                  .max(fixture.pages - 1),
              )
              .max(fixture.pages),
            outline: z.array(outlineEntrySchema).max(1000).nullable(),
            revision: z.number().int().nonnegative(),
            generator: z.string().max(80).nullable().optional(),
          })
          .parse(JSON.parse(await readFile(`${state.directory}/outline.json`, 'utf8')));
      } catch {}
    }
    let pages: number[] = [];
    try {
      pages = (await readdir(`${state.directory}/vision-pdf-1`)).flatMap((name) => {
        const match = name.match(/^page-(\d+)\.json$/);
        return match ? [Number(match[1])] : [];
      });
    } catch {}
    state.cache = saved ?? { id: md5, pages, outline: null, revision: 0 };
    state.cache.pages = pages;
    await import('@pdfjs/pdf.worker.min.mjs');
    const started = performance.now();
    const document = (
      await new DocumentLoader(
        new File([bytes], 'private-evaluation.pdf', { type: 'application/pdf' }),
      ).open()
    ).book;
    expect(document.sections.length).toBe(fixture.pages);
    const reports: PDFContentsReport[] = [];
    let result = 'failed';
    try {
      result = await preparePDFContents(source, document, undefined, (value) =>
        reports.push(value),
      );
    } catch {
      /* Safe failure details come from the production report. */
    } finally {
      await document.destroy?.();
    }
    const elapsedMs = Math.round(performance.now() - started);
    const unchanged =
      createHash('md5')
        .update(await readFile(source))
        .digest('hex') === md5;
    const last = reports.at(-1);
    const record = {
      id: fixture.id,
      mode,
      algorithm: last?.algorithm,
      provenance,
      result,
      elapsedMs,
      unchanged,
      audited: fixture.audited,
      review: fixture.review,
      failure: result === 'generated' || result === 'preserved' ? null : classifyFailure(last),
      terminal: last,
      metrics: evaluateContents(fixture.expected, state.cache.outline ?? [], fixture.audited),
      calls: state.calls,
      reports,
    };
    results.push(record);
    await writeFile(`${state.directory}/result-${mode}.json`, JSON.stringify(record, null, 2), {
      mode: 0o600,
    });
    await writeFile(path.join(output, runID, 'summary.json'), JSON.stringify(results, null, 2), {
      mode: 0o600,
    });
    // Print only counts and safe identifiers, never book paths or text.
    console.log(
      JSON.stringify({
        id: fixture.id,
        result,
        elapsedMs,
        failure: record.failure,
        metrics: record.metrics,
      }),
    );
    expect(unchanged).toBe(true);
  });
}
