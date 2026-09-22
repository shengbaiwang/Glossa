import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ChapterSource } from '@/glossa/context/types';
import type { BookReadingAccess } from '@/glossa/harness/book';
import type { MapCheckpoint } from '@/glossa/mindmap/checkpoints';
import { getMapCheckpointKey, mapCheckpointStore } from '@/glossa/mindmap/checkpoints';
import { ModelServiceError, type CompletionRequest } from '@/glossa/ai/provider';
import { generateOverviewMap, expandMapNode } from '@/glossa/mindmap/explore';
import {
  appendMapBranch,
  createMapFromMindmap,
  getMapNodeSources,
  mapWorkspaceSchema,
} from '@/glossa/mindmap/workspace';
import { validateSavedMindmap } from '@/glossa/mindmap/store';
import { exportMapMarkdown, exportMapSvg, mapQuestion } from '@/glossa/mindmap/export';

const savedJobs = vi.hoisted(
  () => new Map<string, { revision: string; checkpoint: MapCheckpoint }>(),
);
vi.mock('@/glossa/mindmap/checkpoints', async (original) => ({
  ...(await original<typeof import('@/glossa/mindmap/checkpoints')>()),
  mapCheckpointStore: {
    load: async (key: string) =>
      structuredClone(savedJobs.get(key) ?? { revision: null, checkpoint: null }),
    save: async (
      key: string,
      expected: string | null,
      checkpoint: MapCheckpoint,
      signal: AbortSignal,
    ) => {
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      if ((savedJobs.get(key)?.revision ?? null) !== expected)
        throw new Error('Checkpoint conflict');
      const revision = crypto.randomUUID();
      savedJobs.set(key, structuredClone({ revision, checkpoint }));
      return revision;
    },
  },
}));
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  savedJobs.clear();
});
afterEach(() => vi.useRealTimers());
const config = { id: 'test', name: 'Test', baseUrl: 'https://example.test/v1', model: 'test' };
const source = (id: string, text = '条件限定结论的适用范围。'): ChapterSource => ({
  sourceId: id,
  text,
  kind: 'paragraph',
  anchor: {
    sectionIndex: 0,
    cfi: `epubcfi(/6/2!/4/${id.length * 2})`,
    quote: { exact: text, prefix: '', suffix: '' },
  },
});
const sources = [source('s1', '甲'.repeat(12000)), source('s2', '乙'.repeat(12000))];
const access = (): BookReadingAccess => ({
  documentHash: 'book',
  chapters: [{ id: 'chapter', title: '条件', depth: 0 }],
  readAll: vi.fn().mockResolvedValue(sources),
  readChapter: vi.fn().mockResolvedValue(sources),
  search: vi.fn(),
  verifySources: vi.fn(async (s) => s),
});
const body = (ids: string[]) => ({
  nodes: [
    {
      id: 'root',
      parentId: null,
      label: '适用范围',
      relation: '',
      explanation: '结论有条件',
      sourceIds: [ids[0]],
      kind: 'source',
    },
    {
      id: 'child',
      parentId: 'root',
      label: '条件',
      relation: '受限于',
      explanation: '需要明确条件',
      sourceIds: [ids.at(-1)],
      kind: 'source',
    },
  ],
  insufficientEvidence: false,
});
const complete = () =>
  vi.fn(async (request: CompletionRequest) => {
    const input = JSON.parse(request.messages.at(-1)!.content) as {
      sources?: ChapterSource[];
      points?: { text: string; sourceIds: string[] }[];
    };
    if (input.sources)
      return JSON.stringify({
        coveredSourceIds: input.sources.map((s) => s.sourceId),
        points: [
          { text: '结论受到条件限制', sourceIds: input.sources.map((s) => s.sourceId).slice(0, 4) },
        ],
      });
    return JSON.stringify(body(input.points!.flatMap((p) => p.sourceIds)));
  });
const options = () => ({
  bookId: 'book',
  title: '条件论',
  target: { kind: 'book' as const },
  access: access(),
  config,
  signal: new AbortController().signal,
});

it('resumes after a failed last segment without requesting a completed segment again', async () => {
  const failed = complete();
  const run = failed.getMockImplementation()!;
  failed.mockImplementationOnce(run);
  failed.mockRejectedValueOnce(new ModelServiceError('Service unavailable'));
  await expect(generateOverviewMap(options(), { complete: failed })).rejects.toThrow();
  const resumed = complete();
  const result = await generateOverviewMap(options(), { complete: resumed });
  expect(resumed).toHaveBeenCalledTimes(2);
  expect(result.coverage?.sourceCount).toBe(2);
});

it('retries only synthesis when the complete inventory was already collected', async () => {
  const failed = complete();
  const run = failed.getMockImplementation()!;
  failed.mockImplementationOnce(run).mockImplementationOnce(run);
  failed.mockRejectedValueOnce(new ModelServiceError('Service unavailable'));
  await expect(generateOverviewMap(options(), { complete: failed })).rejects.toThrow();
  const resumed = complete();
  await generateOverviewMap(options(), { complete: resumed });
  expect(resumed).toHaveBeenCalledTimes(1);
  expect(JSON.parse(resumed.mock.calls[0]![0].messages.at(-1)!.content).points).toHaveLength(2);
});

it('covers every chunk before synthesis and persists verifiable evidence beyond the old passage limit', async () => {
  const call = complete();
  const result = await generateOverviewMap(options(), { complete: call });
  expect(call).toHaveBeenCalledTimes(3);
  expect(result.coverage).toMatchObject({
    kind: 'book',
    sourceCount: 2,
    characterCount: 24000,
    batches: 2,
  });
  expect(result.sources.map((s) => s.sourceId)).toEqual(['s1', 's2']);
  expect(await validateSavedMindmap(result)).not.toBeNull();
  expect(JSON.stringify(call.mock.calls)).not.toContain('epubcfi');
});
it('does not present missing chunk coverage as a complete map', async () => {
  const call = vi.fn().mockResolvedValue(JSON.stringify({ coveredSourceIds: [], points: [] }));
  await expect(generateOverviewMap(options(), { complete: call })).rejects.toThrow();
  expect(call).toHaveBeenCalledTimes(1);
});
it('rejects an oversized target before sending any text to a model', async () => {
  const input = options();
  input.access.readAll = vi
    .fn()
    .mockResolvedValue(Array.from({ length: 25 }, (_, i) => source(`s${i}`, '字'.repeat(10000))));
  const call = complete();
  await expect(generateOverviewMap(input, { complete: call })).rejects.toThrow();
  expect(call).not.toHaveBeenCalled();
});
it('reads only the selected chapter and rejects forged inventory citations', async () => {
  const input = { ...options(), target: { kind: 'chapter' as const, chapterId: 'chapter' } };
  const call = complete();
  call.mockImplementationOnce(async () =>
    JSON.stringify({
      coveredSourceIds: ['s1'],
      points: [{ text: '条件', sourceIds: ['invented'] }],
    }),
  );
  await expect(generateOverviewMap(input, { complete: call })).rejects.toThrow();
  expect(input.access.readAll).not.toHaveBeenCalled();
});
it('rejects forged final citations and coverage hash tampering', async () => {
  const call = complete();
  const run = call.getMockImplementation()!;
  call.mockImplementation(async (request) =>
    JSON.parse(request.messages.at(-1)!.content).points
      ? JSON.stringify(body(['invented']))
      : run(request),
  );
  await expect(generateOverviewMap(options(), { complete: call })).rejects.toThrow();
  const valid = await generateOverviewMap(options(), { complete: complete() });
  expect(
    await validateSavedMindmap({
      ...valid,
      coverage: { ...valid.coverage!, contentHash: 'f'.repeat(64) },
    }),
  ).toBeNull();
});
it('keeps consecutive headings with their first paragraph when batching', async () => {
  const input = options();
  input.access.readAll = vi
    .fn()
    .mockResolvedValue([
      source('p1', '甲'.repeat(19995)),
      { ...source('h1', '标题'), kind: 'heading' },
      { ...source('h2', '小标题'), kind: 'heading' },
      source('p2'),
    ]);
  const call = complete();
  await generateOverviewMap(input, { complete: call });
  const batches = call.mock.calls
    .slice(0, 2)
    .map(([r]) =>
      JSON.parse(r.messages.at(-1)!.content).sources.map((s: ChapterSource) => s.sourceId),
    );
  expect(batches).toEqual([['m1'], ['m2', 'm3', 'm4']]);
});
it('bounds indivisible-block length recovery and respects the configured output cap', async () => {
  const input = { ...options(), config: { ...config, maxTokens: 4096 } };
  const call = complete();
  const run = call.getMockImplementation()!;
  call.mockRejectedValueOnce(new ModelServiceError('Truncated', 'length'));
  call.mockImplementationOnce(run);
  call.mockRejectedValueOnce(new ModelServiceError('Truncated again', 'length'));
  call.mockRejectedValueOnce(new ModelServiceError('Truncated again', 'length'));
  await expect(generateOverviewMap(input, { complete: call })).rejects.toThrow('Truncated again');
  expect(call).toHaveBeenCalledTimes(4);
  expect(call.mock.calls.every(([r]) => r.maxTokens === 4096)).toBe(true);
});
it('times out even when a model ignores its abort signal', async () => {
  vi.useFakeTimers();
  const call = vi.fn(() => new Promise<string>(() => {}));
  const outcome = generateOverviewMap(options(), { complete: call }).catch(
    (error: unknown) => error,
  );
  // Let the real WebCrypto digest resolve before advancing fake time.
  await vi.waitFor(() => expect(call).toHaveBeenCalledTimes(1));
  await vi.advanceTimersByTimeAsync(480000);
  expect(await outcome).toMatchObject({ message: expect.stringContaining('timed out') });
  expect(call.mock.calls).toHaveLength(1);
});
it('ignores late model responses after cancellation', async () => {
  const controller = new AbortController();
  const call = complete();
  const run = call.getMockImplementation()!;
  call.mockImplementation(async (r) => {
    const response = await run(r);
    controller.abort();
    return response;
  });
  await expect(
    generateOverviewMap({ ...options(), signal: controller.signal }, { complete: call }),
  ).rejects.toThrow();
  expect(call).toHaveBeenCalledTimes(1);
});
it('appends sourced details without replacing user edits and keeps the backup round-trip valid', async () => {
  const original = await generateOverviewMap(options(), { complete: complete() });
  const map = createMapFromMindmap(original);
  map.nodes[1]!.label = '我的修订';
  const branch = await expandMapNode(
    { map, nodeId: 'child', access: access(), config, signal: new AbortController().signal },
    { complete: vi.fn().mockResolvedValue(JSON.stringify(body(['s2']))) },
  );
  const next = appendMapBranch(map, 'child', branch);
  expect(() => appendMapBranch(map, 'child', { ...branch, bookId: 'other-book' })).toThrow();
  expect(next.nodes.find((n) => n.id === 'child')!.label).toBe('我的修订');
  const added = next.nodes.find((n) => !map.nodes.some((old) => old.id === n.id))!;
  expect(getMapNodeSources(next, added.id).map((s) => s.sourceId)).toEqual(['s2']);
  const workspace = { version: 1, bookId: 'book', revision: 0, activeId: next.id, maps: [next] };
  expect(mapWorkspaceSchema.safeParse(JSON.parse(JSON.stringify(workspace))).success).toBe(true);
  expect(exportMapMarkdown(next)).toContain('我的修订');
  expect(mapQuestion(next, 'child')).toContain('我的修订');
  expect(
    exportMapSvg({ ...next, nodes: next.nodes.map((n) => ({ ...n, label: '<script>&"' })) }),
  ).not.toContain('<script>');
});
it('does not send an unverified branch source or expand its reading scope', async () => {
  const original = await generateOverviewMap(options(), { complete: complete() });
  const local = access();
  local.verifySources = vi.fn().mockResolvedValue([]);
  const call = complete();
  await expect(
    expandMapNode(
      {
        map: createMapFromMindmap(original),
        nodeId: 'child',
        access: local,
        config,
        signal: new AbortController().signal,
      },
      { complete: call },
    ),
  ).rejects.toThrow();
  expect(call).not.toHaveBeenCalled();
  expect(local.readAll).not.toHaveBeenCalled();
  expect(local.readChapter).not.toHaveBeenCalled();
  expect(local.search).not.toHaveBeenCalled();
});

it('rechecks current raw material before using saved results and invalidates changed text', async () => {
  await generateOverviewMap(options(), { complete: complete() });
  const input = options();
  input.access.readAll = vi.fn().mockResolvedValue([source('s1', '改'.repeat(12000)), sources[1]]);
  const call = complete();
  await generateOverviewMap(input, { complete: call });
  expect(input.access.readAll).toHaveBeenCalledTimes(1);
  expect(call).toHaveBeenCalledTimes(3);
});
it('restores a finished result without model calls and explicitly restarts when requested', async () => {
  const original = await generateOverviewMap(options(), { complete: complete() });
  const call = complete();
  const resumed = await generateOverviewMap(options(), { complete: call });
  expect(call).not.toHaveBeenCalled();
  expect(resumed.nodes).toEqual(original.nodes);
  expect(await validateSavedMindmap(resumed)).not.toBeNull();
  await generateOverviewMap({ ...options(), restart: true }, { complete: call });
  expect(call).toHaveBeenCalledTimes(3);
});
it('isolates checkpoints by book, target, model, endpoint, reasoning and output preference', async () => {
  const input = options();
  const key = await getMapCheckpointKey(input);
  for (const changed of [
    { ...input, bookId: 'other' },
    { ...input, target: { kind: 'chapter' as const, chapterId: 'chapter' } },
    ...[
      { model: 'other' },
      { baseUrl: 'https://other.test/v1' },
      { reasoningEffort: 'high' as const },
      { maxTokens: 4096 },
    ].map((change) => ({ ...input, config: { ...config, ...change } })),
  ])
    expect(await getMapCheckpointKey(changed)).not.toBe(key);
});
it('does not spend a request if durable checkpoint storage is unavailable', async () => {
  const call = complete();
  await expect(
    generateOverviewMap(options(), {
      complete: call,
      checkpoints: {
        load: mapCheckpointStore.load,
        save: async () => {
          throw new Error('Storage unavailable');
        },
      },
    }),
  ).rejects.toThrow('Storage unavailable');
  expect(call).not.toHaveBeenCalled();
});
it('splits a timed-out batch at paragraph boundaries, preserves completed work, and finishes', async () => {
  vi.useFakeTimers();
  const input = options();
  input.access.readAll = vi
    .fn()
    .mockResolvedValue([source('one'), { ...source('heading'), kind: 'heading' }, source('two')]);
  const call = complete();
  call.mockImplementationOnce(() => new Promise<string>(() => {}));
  const outcome = generateOverviewMap(input, { complete: call });
  await vi.waitFor(() => expect(call).toHaveBeenCalledTimes(1));
  await vi.advanceTimersByTimeAsync(120000);
  const result = await outcome;
  expect(result.coverage?.batches).toBe(2);
  expect(call).toHaveBeenCalledTimes(4);
  const parts = call.mock.calls
    .slice(1, 3)
    .map(([r]) => JSON.parse(r.messages.at(-1)!.content).sources);
  expect(parts.map((part) => part.length)).toEqual([1, 2]);
  expect(parts[1].map((s: { sourceId: string }) => s.sourceId)).toEqual(['m2', 'm3']);
});
it('preserves completed inventories when a user cancels and ignores a late segment result', async () => {
  const controller = new AbortController();
  const call = complete();
  const run = call.getMockImplementation()!;
  call.mockImplementationOnce(run).mockImplementationOnce(async (request) => {
    controller.abort();
    return run(request);
  });
  await expect(
    generateOverviewMap({ ...options(), signal: controller.signal }, { complete: call }),
  ).rejects.toMatchObject({ name: 'AbortError' });
  const resumed = complete();
  await generateOverviewMap(options(), { complete: resumed });
  expect(resumed).toHaveBeenCalledTimes(2);
});

it('gives synthesis its own deadline and resumes without model extraction calls', async () => {
  vi.useFakeTimers();
  const call = complete(),
    run = call.getMockImplementation()!;
  call.mockImplementationOnce(run).mockImplementationOnce(run);
  call.mockImplementationOnce(() => new Promise<string>(() => {}));
  const pending = generateOverviewMap(options(), { complete: call }).catch(
    (error: unknown) => error,
  );
  await vi.waitFor(() => expect(call).toHaveBeenCalledTimes(3));
  await vi.advanceTimersByTimeAsync(180000);
  expect(await pending).toMatchObject({ message: expect.stringContaining('synthesis timed out') });
  const resumed = complete();
  await generateOverviewMap(options(), { complete: resumed });
  expect(resumed).toHaveBeenCalledTimes(1);
});
it('reserves synthesis time and retains inventories when the extraction budget is used up', async () => {
  vi.useFakeTimers();
  const input = options();
  input.access.readAll = vi
    .fn()
    .mockResolvedValue(Array.from({ length: 5 }, (_, i) => source(`p${i}`, '文'.repeat(12000))));
  const call = complete(),
    run = call.getMockImplementation()!;
  let finished = 0;
  call.mockImplementation(async (request) => {
    if (++finished > 3) return new Promise<string>(() => {});
    vi.setSystemTime(Date.now() + 110000);
    return run(request);
  });
  const pending = generateOverviewMap(input, { complete: call }).catch((error: unknown) => error);
  await vi.waitFor(() => expect(call).toHaveBeenCalledTimes(4));
  await vi.advanceTimersByTimeAsync(30000);
  expect(await pending).toMatchObject({ message: expect.stringContaining('timed out') });
  const stored = (await mapCheckpointStore.load(await getMapCheckpointKey(input))).checkpoint!;
  expect(stored.batches.filter((batch) => batch.points !== undefined)).toHaveLength(3);
  const resumed = complete();
  await generateOverviewMap(input, { complete: resumed });
  expect(resumed).toHaveBeenCalledTimes(3);
});
it('does not mix a stale cancelled attempt with a fresh attempt checkpoint', async () => {
  let finish!: (raw: string) => void;
  const controller = new AbortController(),
    old = complete();
  old.mockImplementationOnce(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
  );
  const cancelled = generateOverviewMap(
    { ...options(), signal: controller.signal },
    { complete: old },
  ).catch((error: unknown) => error);
  await vi.waitFor(() => expect(old).toHaveBeenCalledTimes(1));
  controller.abort();
  expect(await cancelled).toMatchObject({ name: 'AbortError' });
  const fresh = await generateOverviewMap(
    { ...options(), restart: true },
    { complete: complete() },
  );
  const key = await getMapCheckpointKey(options()),
    saved = await mapCheckpointStore.load(key);
  finish(
    JSON.stringify({
      coveredSourceIds: ['m1'],
      points: [{ text: 'Late stale result', sourceIds: ['m1'] }],
    }),
  );
  await Promise.resolve();
  expect(await mapCheckpointStore.load(key)).toEqual(saved);
  expect(saved.checkpoint?.result?.nodes).toEqual(fresh.nodes);
});
it('bounds repeated truncated outputs and never synthesizes incomplete coverage', async () => {
  const input = options();
  input.access.readAll = vi
    .fn()
    .mockResolvedValue(Array.from({ length: 8 }, (_, i) => source(`s${i}`)));
  const call = vi.fn().mockRejectedValue(new ModelServiceError('Truncated', 'length'));
  await expect(generateOverviewMap(input, { complete: call })).rejects.toThrow('Truncated');
  expect(call).toHaveBeenCalledTimes(3);
  expect(
    (await mapCheckpointStore.load(await getMapCheckpointKey(input))).checkpoint?.result,
  ).toBeUndefined();
});

it('bounds a stalled stream and saves timing diagnostics without any streamed content', async () => {
  vi.useFakeTimers();
  const call = vi.fn((request: CompletionRequest) => {
    request.onDelta?.('PRIVATE_STREAM_SENTINEL');
    request.onMetrics?.({
      id: 'fixture',
      outputBudget: 4096,
      elapsedMs: 1,
      finished: false,
      usage: { inputTokens: 100 },
    });
    return new Promise<string>(() => {});
  });
  const pending = generateOverviewMap(options(), { complete: call }).catch(
    (error: unknown) => error,
  );
  await vi.waitFor(() => expect(call).toHaveBeenCalledTimes(1));
  await vi.advanceTimersByTimeAsync(120000);
  expect(await pending).toMatchObject({ message: expect.stringContaining('segment timed out') });
  const saved = (await mapCheckpointStore.load(await getMapCheckpointKey(options()))).checkpoint!;
  expect(saved.requests).toEqual([
    expect.objectContaining({
      phase: 'inventory',
      outcome: 'timeout',
      outputBudget: 4096,
      firstTextMs: expect.any(Number),
      usage: { inputTokens: 100 },
    }),
  ]);
  expect(JSON.stringify(saved)).not.toContain('PRIVATE_STREAM_SENTINEL');
  expect(saved.batches.every((batch) => batch.points === undefined)).toBe(true);
});

it('identifies a stalled local read before any model request or saved inventory exists', async () => {
  vi.useFakeTimers();
  const input = options(),
    call = complete();
  input.access.readAll = vi.fn(() => new Promise<ChapterSource[]>(() => {}));
  let failure: unknown;
  const pending = generateOverviewMap(input, { complete: call }).catch((error: unknown) => {
    failure = error;
  });
  await vi.advanceTimersByTimeAsync(60000);
  expect(failure).toMatchObject({ message: expect.stringContaining('Reading material timed out') });
  await pending;
  expect(call).not.toHaveBeenCalled();
});

it('enforces the 26-call limit including recovery and resumes the remaining synthesis', async () => {
  const input = options();
  input.access.readAll = vi
    .fn()
    .mockResolvedValue(Array.from({ length: 4800 }, (_, i) => source(`s${i}`, '观点')));
  const call = complete(),
    run = call.getMockImplementation()!;
  call
    .mockRejectedValueOnce(new ModelServiceError('Truncated', 'length'))
    .mockImplementationOnce(run);
  call
    .mockRejectedValueOnce(new ModelServiceError('Truncated', 'length'))
    .mockImplementationOnce(run);
  await expect(generateOverviewMap(input, { complete: call })).rejects.toThrow('reached its limit');
  expect(call).toHaveBeenCalledTimes(26);
  const saved = (await mapCheckpointStore.load(await getMapCheckpointKey(input))).checkpoint!;
  expect(saved.batches.filter((batch) => batch.points !== undefined)).toHaveLength(24);
  expect(saved.result).toBeUndefined();
  const resumed = complete();
  await generateOverviewMap(input, { complete: resumed });
  expect(resumed).toHaveBeenCalledTimes(1);
});
