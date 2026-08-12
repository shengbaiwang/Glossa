import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  createEpubAnchorNavigator,
  type AnchorNavigationSession,
  type EpubNavigationRuntime,
  type SourceAnchor,
} from '@/glossa';

type MockOverlayer = {
  entries: Map<string, Range>;
  add: ReturnType<
    typeof vi.fn<(key: string, range: Range, draw: unknown, options?: { color?: string }) => void>
  >;
  remove: ReturnType<typeof vi.fn<(key: string) => void>>;
};

type Deferred = { promise: Promise<void>; resolve(): void };

const deferred = (): Deferred => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const makeDocument = (index: number) => {
  const doc = document.implementation.createHTMLDocument(`chapter ${index + 1}`);
  doc.body.innerHTML =
    index === 0
      ? `<section><p id="first">The Aster Index records every amber mark before the reader turns the page.</p>
          <p id="zh">星标索引在读者翻页前记录每一个琥珀色标记。</p>
          <p id="duplicate-1">The first amber mark closes here.</p>
          <p id="duplicate-2">The later amber mark supplies evidence.</p>
          <script>script-only target</script><p hidden>hidden-only target</p></section>`
      : index === 1
        ? '<section><p id="second">A shared margin connects a new question to the Aster Index.</p></section>'
        : '<section><p id="third">A return signal keeps the origin position.</p></section>';
  return doc;
};

const rangeFor = (doc: Document, id: string, exact: string): Range => {
  const element = doc.getElementById(id);
  const node = element?.firstChild;
  if (!node?.textContent) throw new Error(`Missing text node ${id}`);
  const offset = node.textContent.indexOf(exact);
  if (offset < 0) throw new Error(`Missing exact text ${exact}`);
  const range = doc.createRange();
  range.setStart(node, offset);
  range.setEnd(node, offset + exact.length);
  return range;
};

const makeOverlayer = (): MockOverlayer => {
  const entries = new Map<string, Range>();
  return {
    entries,
    add: vi.fn((key: string, range: Range) => {
      entries.set(key, range);
    }),
    remove: vi.fn((key: string) => {
      entries.delete(key);
    }),
  };
};

const anchor = (overrides: Partial<SourceAnchor> = {}): SourceAnchor => ({
  version: 1,
  documentId: 'fixture-book',
  format: 'epub',
  sectionId: 'chapter-1.xhtml',
  cfi: 'cfi:amber',
  quote: { exact: 'amber mark', prefix: 'records every ', suffix: ' before the reader' },
  ...overrides,
});

const createMockRuntime = (options: { initialContents?: boolean } = {}) => {
  const docs = [makeDocument(0), makeDocument(1), makeDocument(2)];
  const overlays = docs.map(() => makeOverlayer());
  const viewTarget = new EventTarget();
  const rendererTarget = new EventTarget();
  let contents = options.initialContents === false ? [] : [0];
  let pendingGoTo: ((target: string | number) => Promise<void>) | null = null;
  const calls: Array<string | number> = [];
  const cfiRanges = new Map<string, { index: number; range: Range }>([
    ['cfi:amber', { index: 0, range: rangeFor(docs[0]!, 'first', 'amber mark') }],
    ['cfi:wrong', { index: 0, range: rangeFor(docs[0]!, 'first', 'Aster Index') }],
    ['cfi:origin', { index: 2, range: rangeFor(docs[2]!, 'third', 'origin position') }],
  ]);
  const resolve = (target: string | number) => {
    if (typeof target === 'number') return { index: target };
    const cfi = cfiRanges.get(target);
    if (cfi) return { index: cfi.index, anchor: (_doc: Document) => cfi.range };
    const hrefIndex = ['chapter-1.xhtml', 'chapter-2.xhtml', 'chapter-3.xhtml'].indexOf(target);
    return hrefIndex < 0 ? undefined : { index: hrefIndex };
  };
  const completeGoTo = async (target: string | number) => {
    const resolved = resolve(target);
    if (!resolved) throw new Error(`unresolved ${target}`);
    contents = [resolved.index];
    (runtime.view as { lastLocation?: unknown }).lastLocation = {
      cfi: typeof target === 'string' && target.startsWith('cfi:') ? target : undefined,
      range:
        typeof resolved.anchor === 'function'
          ? resolved.anchor(docs[resolved.index]!)
          : (() => {
              const range = docs[resolved.index]!.createRange();
              range.selectNodeContents(docs[resolved.index]!.body);
              return range;
            })(),
    };
    viewTarget.dispatchEvent(
      new CustomEvent('load', { detail: { doc: docs[resolved.index], index: resolved.index } }),
    );
    rendererTarget.dispatchEvent(
      new CustomEvent('relocate', { detail: { index: resolved.index } }),
    );
  };
  const addAnnotation = vi.fn();
  const runtime: EpubNavigationRuntime = {
    view: {
      renderer: {
        getContents: () =>
          contents.map((index) => ({ doc: docs[index]!, index, overlayer: overlays[index] })),
        addEventListener: rendererTarget.addEventListener.bind(rendererTarget),
        removeEventListener: rendererTarget.removeEventListener.bind(rendererTarget),
      },
      resolveCFI: (cfi) => {
        if (cfi === 'cfi:invalid') throw new Error('invalid CFI');
        return resolve(cfi);
      },
      resolveNavigation: resolve,
      goTo: async (target) => {
        calls.push(target);
        if (pendingGoTo) return await pendingGoTo(target);
        await completeGoTo(target);
      },
      getCFI: (index, range) => {
        const cfi = `cfi:recovered:${index}:${cfiRanges.size}`;
        cfiRanges.set(cfi, { index, range });
        return cfi;
      },
      lastLocation: {
        cfi: 'cfi:origin',
        range: rangeFor(docs[2]!, 'third', 'origin position'),
      },
      addEventListener: viewTarget.addEventListener.bind(viewTarget),
      removeEventListener: viewTarget.removeEventListener.bind(viewTarget),
      ...({ addAnnotation } as object),
    },
    progress: {
      location: 'cfi:origin',
      sectionHref: 'chapter-3.xhtml',
      index: 2,
      fraction: 0.8,
    },
  };
  return {
    runtime,
    docs,
    overlays,
    calls,
    addAnnotation,
    setPendingGoTo(value: ((target: string | number) => Promise<void>) | null) {
      pendingGoTo = value;
    },
    completeGoTo,
    setContents(indices: number[]) {
      contents = indices;
    },
  };
};

const makeNavigator = (
  holder: { runtime: EpubNavigationRuntime | null },
  options: { timeoutMs?: number; highlightDurationMs?: number } = {},
) =>
  createEpubAnchorNavigator({
    documentId: 'fixture-book',
    getRuntime: () => holder.runtime,
    timeoutMs: options.timeoutMs ?? 1000,
    highlightDurationMs: options.highlightDurationMs ?? 3000,
  });

afterEach(() => {
  vi.useRealTimers();
});

describe('EPUB anchor navigation', () => {
  test('rejects a document mismatch before reading or navigating the runtime', async () => {
    const mock = createMockRuntime();
    const getRuntime = vi.fn(() => mock.runtime);
    const navigator = createEpubAnchorNavigator({ documentId: 'other-book', getRuntime });

    const session = await navigator.navigate(anchor());

    expect(session.result).toEqual({ status: 'not-found', reason: 'document-mismatch' });
    expect(getRuntime).not.toHaveBeenCalled();
    expect(mock.calls).toEqual([]);
  });

  test('rejects malformed or non-EPUB input through SourceAnchor schema validation', async () => {
    const mock = createMockRuntime();
    const navigator = makeNavigator({ runtime: mock.runtime });

    await expect(navigator.navigate({ ...anchor(), format: 'pdf' })).resolves.toMatchObject({
      result: { status: 'not-found', reason: 'invalid-anchor' },
    });
    await expect(navigator.navigate({ ...anchor(), quote: { exact: '' } })).resolves.toMatchObject({
      result: { status: 'not-found', reason: 'invalid-anchor' },
    });
    expect(mock.calls).toEqual([]);
  });

  test('safely reports an unavailable reader', async () => {
    const navigator = makeNavigator({ runtime: null });

    expect((await navigator.navigate(anchor())).result).toEqual({
      status: 'not-found',
      reason: 'reader-unavailable',
    });
  });

  test('accepts a CFI only after its actual Range text matches quote.exact', async () => {
    const mock = createMockRuntime();
    const navigator = makeNavigator({ runtime: mock.runtime });

    const result = (await navigator.navigate(anchor())).result;

    expect(result).toMatchObject({
      status: 'resolved',
      method: 'cfi',
      exact: true,
      canReturn: true,
    });
    expect(mock.calls[0]).toBe('cfi:amber');
    expect(mock.overlays[0]!.add).toHaveBeenCalledOnce();
  });

  test('falls back to TextQuote when CFI parsing fails', async () => {
    const mock = createMockRuntime();
    const navigator = makeNavigator({ runtime: mock.runtime });

    const result = (await navigator.navigate(anchor({ cfi: 'cfi:invalid' }))).result;

    expect(result).toMatchObject({ status: 'resolved', method: 'text-quote', exact: true });
    expect(result.status === 'resolved' && result.anchor.cfi).toMatch(/^cfi:recovered:/u);
  });

  test('does not claim CFI precision when the resolved text mismatches', async () => {
    const mock = createMockRuntime();
    const navigator = makeNavigator({ runtime: mock.runtime });

    const result = (await navigator.navigate(anchor({ cfi: 'cfi:wrong' }))).result;

    expect(result).toMatchObject({ status: 'resolved', method: 'text-quote', exact: true });
  });

  test('uses href sectionId plus TextQuote when CFI is absent', async () => {
    const mock = createMockRuntime();
    const navigator = makeNavigator({ runtime: mock.runtime });

    const result = (await navigator.navigate(anchor({ cfi: undefined }))).result;

    expect(result).toMatchObject({ status: 'resolved', method: 'text-quote', exact: true });
    expect(mock.calls).toContain('chapter-1.xhtml');
  });

  test('uses spine:<index> sectionId plus Unicode TextQuote', async () => {
    const mock = createMockRuntime();
    const navigator = makeNavigator({ runtime: mock.runtime });

    const result = (
      await navigator.navigate(
        anchor({
          cfi: undefined,
          sectionId: 'spine:0',
          quote: { exact: '星标索引在读者翻页前记录每一个琥珀色标记。' },
        }),
      )
    ).result;

    expect(result).toMatchObject({ status: 'resolved', method: 'text-quote', exact: true });
    expect(mock.calls).toContain(0);
  });

  test('uses TextQuote context to choose the right repeated phrase', async () => {
    const mock = createMockRuntime();
    const navigator = makeNavigator({ runtime: mock.runtime });

    const result = (
      await navigator.navigate(
        anchor({
          cfi: undefined,
          quote: { exact: 'amber mark', prefix: 'The later ', suffix: ' supplies evidence' },
        }),
      )
    ).result;

    expect(result).toMatchObject({ status: 'resolved', method: 'text-quote', exact: true });
    expect(mock.overlays[0]!.add.mock.calls.at(-1)?.[1].startContainer.parentElement?.id).toBe(
      'duplicate-2',
    );
  });

  test('returns ambiguous-quote when duplicate candidates remain tied', async () => {
    const mock = createMockRuntime();
    const navigator = makeNavigator({ runtime: mock.runtime });

    const result = (
      await navigator.navigate(anchor({ cfi: undefined, quote: { exact: 'amber mark' } }))
    ).result;

    expect(result).toEqual({ status: 'not-found', reason: 'ambiguous-quote' });
    expect(mock.overlays[0]!.add).not.toHaveBeenCalled();
  });

  test('degrades to a section without fabricating an exact highlight', async () => {
    const mock = createMockRuntime();
    const navigator = makeNavigator({ runtime: mock.runtime });

    const result = (
      await navigator.navigate(anchor({ cfi: undefined, quote: { exact: 'missing quote' } }))
    ).result;

    expect(result).toMatchObject({ status: 'resolved', method: 'section', exact: false });
    expect(mock.overlays[0]!.add).not.toHaveBeenCalled();
  });

  test('reports section-unavailable when neither href nor CFI resolves', async () => {
    const mock = createMockRuntime();
    const navigator = makeNavigator({ runtime: mock.runtime });

    const result = (
      await navigator.navigate(
        anchor({ cfi: undefined, sectionId: 'missing.xhtml', quote: { exact: 'missing quote' } }),
      )
    ).result;

    expect(result).toEqual({ status: 'not-found', reason: 'section-unavailable' });
  });

  test('never treats hidden or script content as a TextQuote candidate', async () => {
    const mock = createMockRuntime();
    const navigator = makeNavigator({ runtime: mock.runtime });

    for (const exact of ['hidden-only target', 'script-only target']) {
      const result = (await navigator.navigate(anchor({ cfi: undefined, quote: { exact } })))
        .result;
      expect(result).toMatchObject({ status: 'resolved', method: 'section', exact: false });
    }
  });

  test('creates a transient overlay without calling annotation persistence', async () => {
    const mock = createMockRuntime();
    const navigator = makeNavigator({ runtime: mock.runtime });

    await navigator.navigate(anchor());

    const key = mock.overlays[0]!.add.mock.calls[0]?.[0] as string;
    expect(key).toMatch(/^glossa-transient:/u);
    expect(key).not.toBe(anchor().cfi);
    expect(mock.addAnnotation).not.toHaveBeenCalled();
  });

  test('highlight timeout removes only its own unique key', async () => {
    vi.useFakeTimers();
    const mock = createMockRuntime();
    const userRange = rangeFor(mock.docs[0]!, 'first', 'amber mark');
    mock.overlays[0]!.entries.set('cfi:amber', userRange);
    const navigator = makeNavigator({ runtime: mock.runtime }, { highlightDurationMs: 25 });
    const pending = navigator.navigate(anchor());
    await vi.runAllTicks();
    const session = await pending;
    expect(session.result.status).toBe('resolved');

    await vi.advanceTimersByTimeAsync(25);

    expect(mock.overlays[0]!.entries.has('cfi:amber')).toBe(true);
    expect(mock.overlays[0]!.remove).not.toHaveBeenCalledWith('cfi:amber');
    expect([...mock.overlays[0]!.entries.keys()]).toEqual(['cfi:amber']);
  });

  test('a new navigation immediately cleans the old transient highlight', async () => {
    const mock = createMockRuntime();
    const navigator = makeNavigator({ runtime: mock.runtime });
    await navigator.navigate(anchor());
    const oldKey = mock.overlays[0]!.add.mock.calls[0]?.[0];

    await navigator.navigate(
      anchor({
        cfi: undefined,
        sectionId: 'chapter-2.xhtml',
        quote: { exact: 'shared margin' },
      }),
    );

    expect(mock.overlays[0]!.remove).toHaveBeenCalledWith(oldKey);
    expect(mock.overlays[1]!.add).toHaveBeenCalledOnce();
  });

  test('dispose clears highlight and prevents return', async () => {
    const mock = createMockRuntime();
    const navigator = makeNavigator({ runtime: mock.runtime });
    const session = await navigator.navigate(anchor());
    const key = mock.overlays[0]!.add.mock.calls[0]?.[0];

    session.dispose();

    expect(mock.overlays[0]!.remove).toHaveBeenCalledWith(key);
    await expect(session.returnToOrigin()).resolves.toBe(false);
  });

  test('returnToOrigin goes back to the captured CFI once and is idempotent', async () => {
    const mock = createMockRuntime();
    const holder = { runtime: mock.runtime as EpubNavigationRuntime | null };
    const navigator = makeNavigator(holder);
    const session = await navigator.navigate(anchor());

    await expect(session.returnToOrigin()).resolves.toBe(true);
    await expect(session.returnToOrigin()).resolves.toBe(false);
    expect(mock.calls.filter((target) => target === 'cfi:origin')).toHaveLength(1);
  });

  test('returnToOrigin safely fails when the document runtime was replaced', async () => {
    const first = createMockRuntime();
    const second = createMockRuntime();
    const holder = { runtime: first.runtime as EpubNavigationRuntime | null };
    const navigator = makeNavigator(holder);
    const session = await navigator.navigate(anchor());
    holder.runtime = second.runtime;

    await expect(session.returnToOrigin()).resolves.toBe(false);
    expect(second.calls).toEqual([]);
  });

  test('AbortSignal cancels a navigation waiting for foliate', async () => {
    const mock = createMockRuntime({ initialContents: false });
    const blocked = deferred();
    mock.setPendingGoTo(() => blocked.promise);
    const navigator = makeNavigator({ runtime: mock.runtime });
    const controller = new AbortController();
    const pending = navigator.navigate(anchor(), { signal: controller.signal });

    controller.abort();

    expect((await pending).result).toEqual({ status: 'not-found', reason: 'aborted' });
    blocked.resolve();
  });

  test('timeout returns a structured result and removes waiting listeners', async () => {
    const mock = createMockRuntime({ initialContents: false });
    const blocked = deferred();
    mock.setPendingGoTo(() => blocked.promise);
    const addView = vi.spyOn(mock.runtime.view, 'addEventListener');
    const removeView = vi.spyOn(mock.runtime.view, 'removeEventListener');
    const navigator = makeNavigator({ runtime: mock.runtime }, { timeoutMs: 20 });

    const result = (await navigator.navigate(anchor())).result;

    expect(result).toEqual({ status: 'not-found', reason: 'timeout' });
    expect(addView).toHaveBeenCalledWith('load', expect.any(Function));
    expect(removeView).toHaveBeenCalledWith('load', expect.any(Function));
    blocked.resolve();
  });

  test('dispose aborts pending work and leaves no overlay', async () => {
    const mock = createMockRuntime({ initialContents: false });
    const blocked = deferred();
    mock.setPendingGoTo(() => blocked.promise);
    const navigator = makeNavigator({ runtime: mock.runtime });
    const pending = navigator.navigate(anchor());

    navigator.dispose();

    expect((await pending).result).toEqual({ status: 'not-found', reason: 'aborted' });
    expect(mock.overlays.every(({ entries }) => entries.size === 0)).toBe(true);
    blocked.resolve();
  });

  test('an obsolete async navigation cannot finish after the newer jump', async () => {
    const mock = createMockRuntime({ initialContents: false });
    const firstBlocked = deferred();
    let first = true;
    mock.setPendingGoTo(async (target) => {
      if (first) {
        first = false;
        await firstBlocked.promise;
      }
      await mock.completeGoTo(target);
    });
    const navigator = makeNavigator({ runtime: mock.runtime });
    const oldPending = navigator.navigate(anchor());
    const newPending = navigator.navigate(
      anchor({
        cfi: undefined,
        sectionId: 'chapter-2.xhtml',
        quote: { exact: 'shared margin' },
      }),
    );

    firstBlocked.resolve();
    const [oldSession, newSession] = await Promise.all([oldPending, newPending]);

    expect(oldSession.result).toEqual({ status: 'not-found', reason: 'aborted' });
    expect(newSession.result).toMatchObject({ status: 'resolved', method: 'text-quote' });
    expect(mock.calls.at(-1)).toMatch(/^cfi:recovered:1:/u);
    expect(mock.overlays[0]!.entries.size).toBe(0);
    expect(mock.overlays[1]!.entries.size).toBe(1);
  });

  test('navigation results stay JSON-safe and contain no runtime objects', async () => {
    const mock = createMockRuntime();
    const navigator = makeNavigator({ runtime: mock.runtime });
    const session: AnchorNavigationSession = await navigator.navigate(anchor());

    const serialized = JSON.stringify(session.result);
    expect(JSON.parse(serialized)).toEqual(session.result);
    expect(serialized).not.toContain('startContainer');
    expect(serialized).not.toContain('renderer');
  });
});
