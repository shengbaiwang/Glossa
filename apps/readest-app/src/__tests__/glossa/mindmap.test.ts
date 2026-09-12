import { webcrypto } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getPassageId } from '@/glossa/guide/passages';
import type { ChapterSource } from '@/glossa/context/types';
import { parseMindmap } from '@/glossa/mindmap/schema';
import { generateMindmap, getMindmapCacheKey } from '@/glossa/mindmap/generate';
import { ModelServiceError } from '@/glossa/ai/provider';

const text = '一个例子能说明什么，受到它的条件限制。';
const sources: ChapterSource[] = [
  {
    sourceId: 's1',
    text,
    kind: 'paragraph',
    anchor: {
      sectionIndex: 0,
      cfi: 'epubcfi(/6/2!/4/2)',
      quote: { exact: text, prefix: '', suffix: '' },
    },
  },
];
const node = (id: string, parentId: string | null = null) => ({
  id,
  parentId,
  label: id === 'root' ? '例子的解释范围' : '适用条件',
  relation: parentId ? '受到限制' : '',
  explanation: text,
  sourceIds: ['s1'],
  kind: 'source',
});
const body = () => ({
  nodes: [node('root'), node('condition', 'root')],
  insufficientEvidence: false,
});
const options = () => ({
  bookId: 'book',
  bookTitle: '测试书',
  chapterId: 'chapter',
  chapterTitle: '例子与条件',
  passage: {
    id: getPassageId('chapter', sources),
    index: 0,
    title: '例子',
    sources,
    characterCount: text.length,
    unavailable: false,
  },
  config: { id: 'test', name: 'Test', baseUrl: 'https://example.test/v1', model: 'test-model' },
});
beforeEach(() => vi.stubGlobal('crypto', webcrypto));

describe('mindmap source and tree protocol', () => {
  it('accepts a sourced relation tree and explicit insufficient evidence', () => {
    expect(parseMindmap(JSON.stringify(body()), sources)).toEqual(body());
    expect(parseMindmap('{"nodes":[],"insufficientEvidence":true}', sources).nodes).toEqual([]);
  });
  it.each([
    [
      'unknown source',
      () => ({ ...body(), nodes: [{ ...node('root'), sourceIds: ['invented'] }] }),
    ],
    ['duplicate id', () => ({ ...body(), nodes: [node('root'), node('root', 'root')] })],
    ['orphan', () => ({ ...body(), nodes: [node('root'), node('child', 'missing')] })],
    ['cycle', () => ({ ...body(), nodes: [node('root'), node('a', 'b'), node('b', 'a')] })],
    ['multiple roots', () => ({ ...body(), nodes: [node('root'), node('other')] })],
    [
      'missing relationship',
      () => ({ ...body(), nodes: [node('root'), { ...node('a', 'root'), relation: '' }] }),
    ],
    ['invented location', () => ({ ...body(), nodes: [{ ...node('root'), cfi: 'fake' }] })],
    [
      'external background',
      () => ({ ...body(), nodes: [{ ...node('root'), kind: 'background' }] }),
    ],
    [
      'too many nodes',
      () => ({
        ...body(),
        nodes: [node('root'), ...Array.from({ length: 24 }, (_, i) => node(`n${i}`, 'root'))],
      }),
    ],
    [
      'too deep',
      () => ({
        ...body(),
        nodes: [node('root'), node('a', 'root'), node('b', 'a'), node('c', 'b'), node('d', 'c')],
      }),
    ],
    ['empty supported result', () => ({ nodes: [], insufficientEvidence: false })],
    ['contradictory insufficient result', () => ({ ...body(), insufficientEvidence: true })],
  ])('rejects %s', (_name, makeBody) => {
    expect(() => parseMindmap(JSON.stringify(makeBody()), sources)).toThrow();
  });
});

describe('mindmap generation boundary', () => {
  it('sends only the selected source snapshot without anchors or history', async () => {
    const onProgress = vi.fn();
    const complete = vi.fn().mockImplementation(async (request) => {
      request.onDelta('partial');
      return JSON.stringify(body());
    });
    const result = await generateMindmap({ ...options(), onProgress }, { complete });
    const request = complete.mock.calls[0]![0];
    expect(request.messages).toHaveLength(2);
    expect(JSON.parse(request.messages[1].content)).toEqual({
      bookTitle: '测试书',
      chapterTitle: '例子与条件',
      sources: [{ sourceId: 's1', text, kind: 'paragraph' }],
    });
    expect(request.messages[1].content).not.toContain('epubcfi');
    expect(onProgress).toHaveBeenCalled();
    expect(result.nodes).toEqual(body().nodes);
    expect(result.sources).toEqual(sources);
    expect(result.sources).not.toBe(sources);
  });
  it('changes cache for model, book or anchors', async () => {
    const { passage, config } = options();
    const first = await getMindmapCacheKey('book', passage, config);
    expect(await getMindmapCacheKey('book', passage, { ...config, model: 'other' })).not.toBe(
      first,
    );
    expect(await getMindmapCacheKey('other', passage, config)).not.toBe(first);
    const changed = {
      ...passage,
      sources: [{ ...sources[0]!, anchor: { ...sources[0]!.anchor, cfi: 'other' } }],
    };
    expect(await getMindmapCacheKey('book', changed, config)).not.toBe(first);
  });
  it('rejects unavailable or mismatched passages before any API call', async () => {
    const complete = vi.fn();
    await expect(
      generateMindmap(
        { ...options(), passage: { ...options().passage, unavailable: true } },
        { complete },
      ),
    ).rejects.toThrow();
    await expect(
      generateMindmap({ ...options(), chapterId: 'different' }, { complete }),
    ).rejects.toThrow();
    expect(complete).not.toHaveBeenCalled();
  });
  it('discards a late response after cancellation', async () => {
    const controller = new AbortController();
    const complete = vi.fn().mockImplementation(async () => {
      controller.abort();
      return JSON.stringify(body());
    });
    await expect(
      generateMindmap({ ...options(), signal: controller.signal }, { complete }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('retries output exhaustion once using the same sources', async () => {
    const complete = vi
      .fn()
      .mockRejectedValueOnce(new ModelServiceError('cut', 'length'))
      .mockResolvedValue(JSON.stringify(body()));
    await generateMindmap(options(), { complete });
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[1]![0].messages[1]).toEqual(complete.mock.calls[0]![0].messages[1]);
  });
});
