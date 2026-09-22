import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ChapterSource } from '@/glossa/context/types';
import type { BookReadingAccess } from '@/glossa/harness/book';
import type { MapCheckpoint } from '@/glossa/mindmap/checkpoints';
import type { InventoryPoints } from '@/glossa/mindmap/inventoryCache';
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
const cachedInventories = vi.hoisted(() => new Map<string, InventoryPoints>());
vi.mock('@/glossa/mindmap/inventoryCache', async (original) => ({
  ...(await original<typeof import('@/glossa/mindmap/inventoryCache')>()),
  mapInventoryStore: {
    load: async (key: string) => structuredClone(cachedInventories.get(key) ?? null),
    save: async (key: string, points: InventoryPoints, signal: AbortSignal) => {
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      cachedInventories.set(key, structuredClone(points));
    },
  },
}));
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
  cachedInventories.clear();
  config.baseUrl = `https://test-${crypto.randomUUID()}.example/v1`;
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

it('runs independent inventories concurrently and waits for both before synthesis', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const call = complete(),
    run = call.getMockImplementation()!;
  call.mockImplementation(async (request) => {
    if (JSON.parse(request.messages.at(-1)!.content).sources) await gate;
    return run(request);
  });
  const pending = generateOverviewMap(options(), { complete: call });
  try {
    await vi.waitFor(() => expect(call).toHaveBeenCalledTimes(2), { timeout: 200 });
    expect(
      call.mock.calls.every(([request]) => JSON.parse(request.messages.at(-1)!.content).sources),
    ).toBe(true);
  } finally {
    release();
    await pending;
  }
  expect(call).toHaveBeenCalledTimes(3);
});

it('packs small sections without adding model requests just to align chapter boundaries', async () => {
  const input = options();
  const material = Array.from({ length: 12 }, (_, index) => {
    const block = source(`s${index}`, '论点与限定。'.repeat(100));
    return { ...block, anchor: { ...block.anchor, sectionIndex: index } };
  });
  input.access.readAll = vi.fn().mockResolvedValue(material);
  const call = complete();
  const map = await generateOverviewMap(input, { complete: call });
  expect(call).toHaveBeenCalledTimes(2);
  expect(map.coverage?.sourceCount).toBe(12);
});

it('serializes competing splits at the batch cap without poisoning later checkpoint saves', async () => {
  const input = options();
  input.access.readAll = vi
    .fn()
    .mockResolvedValue(Array.from({ length: 4600 }, (_, index) => source(`s${index}`, '论点')));
  const call = complete();
  call.mockRejectedValueOnce(new ModelServiceError('Truncated', 'length'));
  call.mockRejectedValueOnce(new ModelServiceError('Truncated', 'length'));
  await expect(generateOverviewMap(input, { complete: call })).rejects.toThrow('reached its limit');
  const checkpoint = (await mapCheckpointStore.load(await getMapCheckpointKey(input))).checkpoint!;
  expect(checkpoint.batches).toHaveLength(24);
  expect(checkpoint.batches.filter((batch) => batch.points !== undefined)).toHaveLength(23);
  const resumed = complete();
  await generateOverviewMap(input, { complete: resumed });
  expect(resumed).toHaveBeenCalledTimes(2);
});

it('generates a complete short chapter with one model call and restores it without another', async () => {
  const input = { ...options(), target: { kind: 'chapter' as const, chapterId: 'chapter' } };
  input.access.readChapter = vi.fn().mockResolvedValue([source('s1'), source('s2')]);
  const call = vi.fn(async (request: CompletionRequest) => {
    const { sources: material } = JSON.parse(request.messages.at(-1)!.content) as {
      sources: ChapterSource[];
    };
    const ids = material.map((s) => s.sourceId);
    return JSON.stringify({ coveredSourceIds: ids, map: body(ids) });
  });
  const map = await generateOverviewMap(input, { complete: call });
  expect(call).toHaveBeenCalledTimes(1);
  expect(map.coverage).toMatchObject({ kind: 'chapter', sourceCount: 2 });
  expect(await validateSavedMindmap(map)).not.toBeNull();
  await generateOverviewMap(input, { complete: call });
  expect(call).toHaveBeenCalledTimes(1);
  expect(input.access.readAll).not.toHaveBeenCalled();
});

it('reuses a verified chapter inventory when generating the whole book', async () => {
  const input = options();
  input.access.readChapter = vi.fn().mockResolvedValue([sources[0]]);
  await generateOverviewMap(
    { ...input, title: 'Chapter title', target: { kind: 'chapter', chapterId: 'chapter' } },
    { complete: complete() },
  );
  const call = complete();
  const map = await generateOverviewMap(input, { complete: call });
  expect(call).toHaveBeenCalledTimes(2);
  const inventories = call.mock.calls.filter(
    ([r]) => JSON.parse(r.messages.at(-1)!.content).sources,
  );
  expect(JSON.parse(inventories[0]![0].messages.at(-1)!.content).sources[0].text).toBe(
    sources[1]!.text,
  );
  expect(map.coverage?.sourceCount).toBe(2);
});

it('commits out-of-order batches without losing progress and synthesizes in original order', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const call = complete(),
    run = call.getMockImplementation()!;
  call.mockImplementation(async (request) => {
    if (JSON.parse(request.messages.at(-1)!.content).sources?.[0]?.sourceId === 'm1') await gate;
    return run(request);
  });
  const input = options(),
    pending = generateOverviewMap(input, { complete: call });
  try {
    await vi.waitFor(() => {
      const checkpoint = [...savedJobs.values()][0]!.checkpoint;
      expect(checkpoint.batches[1]!.points).toBeDefined();
      expect(checkpoint.batches[0]!.points).toBeUndefined();
    });
    expect(call).toHaveBeenCalledTimes(2);
  } finally {
    release();
    await pending;
  }
  const points = JSON.parse(call.mock.calls.at(-1)![0].messages.at(-1)!.content).points;
  expect(points.map((point: { sourceIds: string[] }) => point.sourceIds)).toEqual([['m1'], ['m2']]);
  const saved = (await mapCheckpointStore.load(await getMapCheckpointKey(input))).checkpoint!;
  expect(saved.batches.every((batch) => batch.points !== undefined)).toBe(true);
  expect(saved.requests?.slice(0, 2).map((request) => request.start)).toEqual([1, 0]);
});

it('rejects missing direct coverage and forged direct citations without saving a complete map', async () => {
  for (const invalid of [
    { coveredSourceIds: ['m1'], map: body(['m1']) },
    { coveredSourceIds: ['m1', 'm2'], map: body(['forged']) },
  ]) {
    const input = {
      ...options(),
      restart: true,
      target: { kind: 'chapter' as const, chapterId: 'chapter' },
    };
    input.access.readChapter = vi.fn().mockResolvedValue([source('s1'), source('s2')]);
    await expect(
      generateOverviewMap(input, { complete: vi.fn().mockResolvedValue(JSON.stringify(invalid)) }),
    ).rejects.toThrow();
    expect(
      (await mapCheckpointStore.load(await getMapCheckpointKey(input))).checkpoint?.result,
    ).toBeUndefined();
    expect(input.access.readAll).not.toHaveBeenCalled();
  }
});

it('falls back from a truncated short-chapter response within the same task budget', async () => {
  const input = { ...options(), target: { kind: 'chapter' as const, chapterId: 'chapter' } };
  input.access.readChapter = vi.fn().mockResolvedValue([source('s1'), source('s2')]);
  const call = complete();
  call.mockRejectedValueOnce(new ModelServiceError('Truncated', 'length'));
  const result = await generateOverviewMap(input, { complete: call });
  expect(call).toHaveBeenCalledTimes(3);
  expect(result.coverage?.sourceCount).toBe(2);
  const saved = (await mapCheckpointStore.load(await getMapCheckpointKey(input))).checkpoint!;
  expect(saved.direct).toBeUndefined();
  expect(saved.batches[0]?.points).toBeDefined();
});

it('invalidates shared inventories when source context or model settings change', async () => {
  for (const change of ['context', 'model', 'reasoning', 'output'] as const) {
    savedJobs.clear();
    cachedInventories.clear();
    const input = options();
    input.access.sourceContext = () => ({
      heading: 'Original heading',
      sectionTitles: ['Chapter'],
    });
    await generateOverviewMap(input, { complete: complete() });
    input.access.readChapter = vi.fn().mockResolvedValue([sources[0]]);
    if (change === 'context')
      input.access.sourceContext = () => ({
        heading: 'Changed heading',
        sectionTitles: ['Chapter'],
      });
    const changed = {
      ...input,
      title: 'Chapter',
      target: { kind: 'chapter' as const, chapterId: 'chapter' },
      config: {
        ...input.config,
        ...(change === 'model' ? { model: 'other' } : {}),
        ...(change === 'reasoning' ? { reasoningEffort: 'high' as const } : {}),
        ...(change === 'output' ? { maxTokens: 4096 } : {}),
      },
    };
    const call = complete();
    await generateOverviewMap(changed, { complete: call });
    expect(call).toHaveBeenCalledTimes(2);
  }
});

it('does not let a cached inventory expand chapter permission and tolerates an unavailable optional cache', async () => {
  const input = { ...options(), target: { kind: 'chapter' as const, chapterId: 'chapter' } };
  input.access.readChapter = vi.fn().mockResolvedValue([sources[0]]);
  for (const load of [
    async () => [{ text: 'Foreign chapter', sourceIds: ['s2'] }],
    async () => {
      throw new Error('Cache unavailable');
    },
  ]) {
    savedJobs.clear();
    const call = complete();
    const result = await generateOverviewMap(input, {
      complete: call,
      inventories: {
        load,
        save: async () => {
          throw new Error('Quota');
        },
      },
    });
    expect(call).toHaveBeenCalledTimes(2);
    expect(result.sources.map((source) => source.sourceId)).toEqual(['s1']);
  }
  expect(input.access.readAll).not.toHaveBeenCalled();
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
  expect(call).toHaveBeenCalledTimes(3);
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
  call.mockImplementation(async () =>
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
  expect(batches).toHaveLength(2);
  expect(batches).toEqual(expect.arrayContaining([['m1'], ['m2', 'm3', 'm4']]));
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
  await vi.waitFor(() => expect(call).toHaveBeenCalledTimes(2));
  await vi.advanceTimersByTimeAsync(480000);
  expect(await outcome).toMatchObject({ message: expect.stringContaining('timed out') });
  expect(call.mock.calls).toHaveLength(2);
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
  expect(call).toHaveBeenCalledTimes(2);
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
  await vi.waitFor(() => expect(call).toHaveBeenCalledTimes(5));
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
  await vi.waitFor(() => expect(old.mock.calls.length).toBeGreaterThanOrEqual(1));
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
  await vi.waitFor(() => expect(call).toHaveBeenCalledTimes(2));
  await vi.advanceTimersByTimeAsync(120000);
  expect(await pending).toMatchObject({ message: expect.stringContaining('segment timed out') });
  const saved = (await mapCheckpointStore.load(await getMapCheckpointKey(options()))).checkpoint!;
  expect(saved.requests).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        phase: 'inventory',
        outcome: 'timeout',
        outputBudget: 4096,
        firstTextMs: expect.any(Number),
        usage: { inputTokens: 100 },
      }),
    ]),
  );
  expect(saved.requests).toHaveLength(2);
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

it('reserves a synthesis call within the 26-call cap and resumes remaining extraction', async () => {
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
  expect(call).toHaveBeenCalledTimes(25);
  const saved = (await mapCheckpointStore.load(await getMapCheckpointKey(input))).checkpoint!;
  expect(saved.batches.filter((batch) => batch.points !== undefined)).toHaveLength(23);
  expect(saved.result).toBeUndefined();
  const resumed = complete();
  await generateOverviewMap(input, { complete: resumed });
  expect(resumed).toHaveBeenCalledTimes(2);
});

it('repairs a malformed direct map using safe field feedback and the same complete sources', async () => {
  const input = { ...options(), target: { kind: 'chapter' as const, chapterId: 'chapter' } };
  input.access.readChapter = vi.fn().mockResolvedValue([source('s1'), source('s2')]);
  const malformed = body(['m1', 'm2']);
  malformed.nodes[1]!.label = 'PRIVATE_RESPONSE'.repeat(6);
  const call = vi
    .fn()
    .mockResolvedValueOnce(JSON.stringify({ coveredSourceIds: ['m1', 'm2'], map: malformed }))
    .mockResolvedValueOnce(
      JSON.stringify({ coveredSourceIds: ['m1', 'm2'], map: body(['m1', 'm2']) }),
    );
  const map = await generateOverviewMap(input, { complete: call });
  expect(map.nodes).toHaveLength(2);
  expect(call).toHaveBeenCalledTimes(2);
  expect(call.mock.calls[0]![0].responseFormat).toEqual({ type: 'json_object' });
  expect(call.mock.calls[1]![0].messages[0].content).toContain('map.nodes.1.label');
  expect(call.mock.calls[1]![0].messages.at(-1)).toEqual(call.mock.calls[0]![0].messages.at(-1));
  expect(JSON.stringify(call.mock.calls[1]![0].messages)).not.toContain('PRIVATE_RESPONSE');
  const saved = (await mapCheckpointStore.load(await getMapCheckpointKey(input))).checkpoint!;
  expect(saved.requests?.map((request) => request.outcome)).toEqual(['invalid', 'valid']);
  expect(JSON.stringify(saved)).not.toContain('PRIVATE_RESPONSE');
});

it('changes a repeatedly invalid direct path to inventories and carries safe failure feedback across resume', async () => {
  const input = { ...options(), target: { kind: 'chapter' as const, chapterId: 'chapter' } };
  input.access.readChapter = vi.fn().mockResolvedValue([source('s1'), source('s2')]);
  const invalid = vi.fn().mockResolvedValue('PRIVATE_RESPONSE_NOT_JSON');
  await expect(generateOverviewMap(input, { complete: invalid })).rejects.toThrow();
  const checkpoint = (await mapCheckpointStore.load(await getMapCheckpointKey(input))).checkpoint!;
  expect(checkpoint.skipDirect).toBe(true);
  expect(checkpoint.batches[0]?.failure?.kind).toBe('format');
  expect(invalid.mock.calls.length).toBeLessThanOrEqual(4);
  const call = complete();
  await generateOverviewMap(input, { complete: call });
  expect(call).toHaveBeenCalledTimes(2);
  expect(call.mock.calls[0]![0].messages[0]!.content).toContain(
    'Previous response failed validation',
  );
  expect(call.mock.calls[0]![0].messages[0]!.content).toContain('points');
  expect(JSON.stringify(checkpoint)).not.toContain('PRIVATE_RESPONSE');
});

it('repairs inventory and synthesis validation failures within the shared two-recovery allowance', async () => {
  const input = options();
  input.access.readAll = vi.fn().mockResolvedValue([sources[0]]);
  const call = complete(),
    run = call.getMockImplementation()!;
  let inventoryCalls = 0,
    synthesisCalls = 0;
  call.mockImplementation(async (request) => {
    if (JSON.parse(request.messages.at(-1)!.content).sources) {
      if (++inventoryCalls === 1) return JSON.stringify({ coveredSourceIds: [], points: [] });
    } else if (++synthesisCalls === 1) return JSON.stringify(body(['forged']));
    return run(request);
  });
  await generateOverviewMap(input, { complete: call });
  expect(call).toHaveBeenCalledTimes(4);
  const saved = (await mapCheckpointStore.load(await getMapCheckpointKey(input))).checkpoint!;
  expect(saved.requests?.map((request) => request.outcome)).toEqual([
    'invalid',
    'valid',
    'invalid',
    'valid',
  ]);
  expect(
    saved.requests
      ?.filter((request) => request.diagnostic)
      .map((request) => request.diagnostic?.kind),
  ).toEqual(['coverage', 'sources']);
});

it('counts an explicitly unsupported JSON mode as a bounded recovery and remembers it for resume', async () => {
  const input = options();
  input.access.readAll = vi.fn().mockResolvedValue([sources[0]]);
  const call = complete();
  call.mockRejectedValueOnce(new ModelServiceError('Unsupported format', 'unsupported_format'));
  const map = await generateOverviewMap(input, { complete: call });
  expect(map.nodes.length).toBeGreaterThan(0);
  expect(call).toHaveBeenCalledTimes(3);
  expect(call.mock.calls[0]![0].responseFormat).toEqual({ type: 'json_object' });
  expect(call.mock.calls.slice(1).every(([request]) => request.responseFormat === undefined)).toBe(
    true,
  );
  const saved = (await mapCheckpointStore.load(await getMapCheckpointKey(input))).checkpoint!;
  expect(saved.promptOnly).toBe(true);
});

it('recovers two concurrent explicit JSON-mode rejections without increasing the shared allowance', async () => {
  const input = options();
  const call = complete(),
    run = call.getMockImplementation()!;
  let started = 0,
    release!: () => void;
  const bothStarted = new Promise<void>((resolve) => {
    release = resolve;
  });
  call.mockImplementation(async (request) => {
    if (request.responseFormat) {
      if (++started === 2) release();
      await bothStarted;
      throw new ModelServiceError('Unsupported', 'unsupported_format');
    }
    return run(request);
  });
  await generateOverviewMap(input, { complete: call });
  expect(call.mock.calls.filter(([request]) => request.responseFormat)).toHaveLength(2);
  expect(call).toHaveBeenCalledTimes(5);
});

it('stops a validation repair on cancellation and preserves the last diagnosed checkpoint', async () => {
  const controller = new AbortController();
  const input = { ...options(), signal: controller.signal };
  input.access.readAll = vi.fn().mockResolvedValue([sources[0]]);
  let release!: (value: string) => void;
  const call = complete();
  call.mockResolvedValueOnce('invalid JSON').mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const pending = generateOverviewMap(input, { complete: call }).catch((error: unknown) => error);
  await vi.waitFor(() => expect(call).toHaveBeenCalledTimes(2));
  const saved = await mapCheckpointStore.load(await getMapCheckpointKey(input));
  controller.abort();
  expect(await pending).toMatchObject({ name: 'AbortError' });
  release(JSON.stringify({ coveredSourceIds: ['m1'], points: [] }));
  await Promise.resolve();
  expect(await mapCheckpointStore.load(await getMapCheckpointKey(input))).toEqual(saved);
  expect(saved.checkpoint?.requests?.map((request) => request.outcome)).toEqual(['invalid']);
});
