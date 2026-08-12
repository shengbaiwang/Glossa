import { Overlayer } from 'foliate-js/overlayer.js';

import type {
  AnchorNavigationFailureReason,
  AnchorNavigationResult,
  AnchorNavigationSession,
  DocumentNavigator,
} from '../citations/navigation';
import { sourceAnchorSchema, type SourceAnchor } from '../citations/sourceAnchor';
import { isEpubReadableTextNode, textFromEpubRange } from './epub';

type RangeAnchor = (doc: Document) => unknown;

type EpubNavigationContent = {
  doc: Document;
  index?: number;
  overlayer?: {
    add(key: string, range: Range, draw: unknown, options?: { color?: string }): void;
    remove(key: string): void;
  };
};

type ResolvedNavigation = { index: number; anchor?: RangeAnchor | number };

type EpubNavigationView = {
  renderer: {
    getContents(): EpubNavigationContent[];
    addEventListener?(type: string, listener: EventListener): void;
    removeEventListener?(type: string, listener: EventListener): void;
  };
  resolveCFI(cfi: string): ResolvedNavigation | null | undefined;
  resolveNavigation(target: string | number): ResolvedNavigation | null | undefined;
  goTo(target: string | number): void | Promise<unknown>;
  goToFraction?(fraction: number): void | Promise<unknown>;
  getCFI(index: number, range: Range): string;
  lastLocation?: unknown;
  addEventListener?(type: string, listener: EventListener): void;
  removeEventListener?(type: string, listener: EventListener): void;
};

export type EpubNavigationRuntime = {
  view: EpubNavigationView;
  progress: unknown;
};

export type EpubAnchorNavigatorOptions = {
  documentId: string;
  getRuntime(): EpubNavigationRuntime | null;
  timeoutMs?: number;
  highlightDurationMs?: number;
  highlightColor?: string;
};

type OriginLocation = {
  documentId: string;
  runtime: EpubNavigationRuntime;
  cfi?: string;
  sectionHref?: string;
  sectionIndex?: number;
  fraction?: number;
};

type TextPoint = { node: Text; offset: number };
type NormalizedText = {
  text: string;
  starts: TextPoint[];
  ends: TextPoint[];
};

type QuoteMatch =
  | { status: 'matched'; range: Range }
  | { status: 'not-found' }
  | { status: 'ambiguous' };

type ActiveHighlight = {
  key: string;
  overlayer: NonNullable<EpubNavigationContent['overlayer']>;
  timer: ReturnType<typeof setTimeout>;
};

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_HIGHLIGHT_DURATION_MS = 3000;
const DEFAULT_HIGHLIGHT_COLOR = '#f0b429';
const SPINE_SECTION = /^spine:(0|[1-9]\d*)$/u;
const COLLAPSIBLE_WHITESPACE = /[\s\u00a0]/u;
const BLOCK_CONTAINER =
  'p, li, blockquote, pre, h1, h2, h3, h4, h5, h6, td, th, figcaption, dd, dt';

let navigatorCounter = 0;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;

const asFiniteNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const asInteger = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;

const isRange = (value: unknown): value is Range => {
  const record = asRecord(value);
  return (
    !!record &&
    typeof record['cloneRange'] === 'function' &&
    typeof record['compareBoundaryPoints'] === 'function' &&
    typeof record['toString'] === 'function' &&
    'startContainer' in record &&
    'endContainer' in record
  );
};

const normalizeQuoteText = (value: string): string => value.replace(/[\s\u00a0]+/gu, ' ').trim();

const point = (node: Text, offset: number): TextPoint => ({ node, offset });

const appendNormalizedCharacter = (
  output: NormalizedText,
  character: string,
  start: TextPoint,
  end: TextPoint,
) => {
  if (COLLAPSIBLE_WHITESPACE.test(character)) {
    if (!output.text || output.text.endsWith(' ')) {
      if (output.text.endsWith(' ')) output.ends[output.ends.length - 1] = end;
      return;
    }
    output.text += ' ';
  } else {
    output.text += character;
  }
  output.starts.push(start);
  output.ends.push(end);
};

/** Build one searchable chapter stream while retaining DOM boundary mappings. */
const normalizedDocumentText = (doc: Document): NormalizedText => {
  const output: NormalizedText = { text: '', starts: [], ends: [] };
  if (!doc.body) return output;
  const showText = doc.defaultView?.NodeFilter.SHOW_TEXT ?? 4;
  const walker = doc.createTreeWalker(doc.body, showText);
  let previous: Text | null = null;
  let candidate: Node | null;
  while ((candidate = walker.nextNode())) {
    const node = candidate as Text;
    if (!isEpubReadableTextNode(node) || !node.data) continue;
    const previousBlock = previous?.parentElement?.closest(BLOCK_CONTAINER);
    const currentBlock = node.parentElement?.closest(BLOCK_CONTAINER);
    if (
      previous &&
      previousBlock !== currentBlock &&
      output.text &&
      !output.text.endsWith(' ') &&
      !COLLAPSIBLE_WHITESPACE.test(node.data[0] ?? '')
    ) {
      appendNormalizedCharacter(output, ' ', point(previous, previous.data.length), point(node, 0));
    }
    for (let offset = 0; offset < node.data.length; offset++) {
      appendNormalizedCharacter(
        output,
        node.data[offset]!,
        point(node, offset),
        point(node, offset + 1),
      );
    }
    previous = node;
  }
  if (output.text.endsWith(' ')) {
    output.text = output.text.slice(0, -1);
    output.starts.pop();
    output.ends.pop();
  }
  return output;
};

const allOccurrences = (text: string, exact: string): number[] => {
  const occurrences: number[] = [];
  let offset = 0;
  while (offset <= text.length - exact.length) {
    const index = text.indexOf(exact, offset);
    if (index < 0) break;
    occurrences.push(index);
    offset = index + Math.max(1, exact.length);
  }
  return occurrences;
};

const contextScore = (
  documentText: string,
  start: number,
  end: number,
  quote: SourceAnchor['quote'],
): number => {
  let score = 0;
  const prefix = quote.prefix ? normalizeQuoteText(quote.prefix) : '';
  const suffix = quote.suffix ? normalizeQuoteText(quote.suffix) : '';
  if (prefix && documentText.slice(0, start).trimEnd().endsWith(prefix)) score++;
  if (suffix && documentText.slice(end).trimStart().startsWith(suffix)) score++;
  return score;
};

export const resolveEpubTextQuote = (doc: Document, quote: SourceAnchor['quote']): QuoteMatch => {
  const normalized = normalizedDocumentText(doc);
  const exact = normalizeQuoteText(quote.exact);
  if (!exact) return { status: 'not-found' };
  const occurrences = allOccurrences(normalized.text, exact);
  if (occurrences.length === 0) return { status: 'not-found' };

  let selected = occurrences[0]!;
  if (occurrences.length > 1) {
    const scored = occurrences.map((start) => ({
      start,
      score: contextScore(normalized.text, start, start + exact.length, quote),
    }));
    const bestScore = Math.max(...scored.map(({ score }) => score));
    const best = scored.filter(({ score }) => score === bestScore);
    if (best.length !== 1) return { status: 'ambiguous' };
    selected = best[0]!.start;
  }

  const start = normalized.starts[selected];
  const end = normalized.ends[selected + exact.length - 1];
  if (!start || !end) return { status: 'not-found' };
  const range = doc.createRange();
  try {
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
  } catch {
    return { status: 'not-found' };
  }
  return { status: 'matched', range };
};

const readLocationRecord = (runtime: EpubNavigationRuntime) => {
  const progress = asRecord(runtime.progress);
  const lastLocation = asRecord(runtime.view.lastLocation);
  const cfi =
    (typeof lastLocation?.['cfi'] === 'string' && lastLocation['cfi'].trim()
      ? lastLocation['cfi']
      : undefined) ??
    (typeof progress?.['location'] === 'string' && progress['location'].trim()
      ? progress['location']
      : undefined);
  const sectionHref =
    typeof progress?.['sectionHref'] === 'string' && progress['sectionHref'].trim()
      ? progress['sectionHref']
      : undefined;
  const sectionIndex =
    asInteger(progress?.['index']) ?? asInteger(asRecord(lastLocation?.['section'])?.['current']);
  const fraction =
    asFiniteNumber(progress?.['fraction']) ?? asFiniteNumber(lastLocation?.['fraction']);
  return { cfi, sectionHref, sectionIndex, fraction };
};

const captureOrigin = (
  documentId: string,
  runtime: EpubNavigationRuntime,
): OriginLocation | null => {
  const location = readLocationRecord(runtime);
  if (
    !location.cfi &&
    !location.sectionHref &&
    location.sectionIndex === undefined &&
    location.fraction === undefined
  ) {
    return null;
  }
  return { documentId, runtime, ...location };
};

const sectionTarget = (
  view: EpubNavigationView,
  sectionId: string | undefined,
  fallbackIndex?: number,
): { target: string | number; resolved: ResolvedNavigation } | null => {
  if (sectionId) {
    const spine = SPINE_SECTION.exec(sectionId);
    if (spine) {
      const index = Number(spine[1]);
      return { target: index, resolved: { index } };
    }
    try {
      const resolved = view.resolveNavigation(sectionId);
      if (resolved && asInteger(resolved.index) !== undefined)
        return { target: sectionId, resolved };
    } catch {
      // CFI/TextQuote recovery reports a structured failure below.
    }
  }
  return fallbackIndex === undefined
    ? null
    : { target: fallbackIndex, resolved: { index: fallbackIndex } };
};

const renderedContent = (
  runtime: EpubNavigationRuntime,
  index: number,
): EpubNavigationContent | null => {
  try {
    return (
      runtime.view.renderer
        .getContents()
        .find((content) => content.index === index && content.doc?.nodeType === 9) ?? null
    );
  } catch {
    return null;
  }
};

const abortError = () => new DOMException('Navigation aborted', 'AbortError');

const throwIfAborted = (signal: AbortSignal) => {
  if (signal.aborted) throw abortError();
};

const abortable = <T>(promise: Promise<T>, signal: AbortSignal): Promise<T> => {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
};

const waitForRenderedContent = (
  runtime: EpubNavigationRuntime,
  index: number,
  signal: AbortSignal,
): Promise<EpubNavigationContent> => {
  const current = renderedContent(runtime, index);
  if (current) return Promise.resolve(current);
  return new Promise<EpubNavigationContent>((resolve, reject) => {
    let frame = 0;
    let settled = false;
    const finish = (content?: EpubNavigationContent, error?: unknown) => {
      if (settled) return;
      settled = true;
      runtime.view.removeEventListener?.('load', check);
      runtime.view.renderer.removeEventListener?.('relocate', check);
      signal.removeEventListener('abort', onAbort);
      if (frame) cancelAnimationFrame(frame);
      if (content) resolve(content);
      else reject(error ?? new Error('EPUB section unavailable'));
    };
    const check: EventListener = () => {
      const content = renderedContent(runtime, index);
      if (content) finish(content);
    };
    const onAbort = () => finish(undefined, abortError());
    runtime.view.addEventListener?.('load', check);
    runtime.view.renderer.addEventListener?.('relocate', check);
    signal.addEventListener('abort', onAbort, { once: true });
    queueMicrotask(() => {
      check(new Event('check'));
      if (!settled && typeof requestAnimationFrame === 'function') {
        frame = requestAnimationFrame(() => check(new Event('check')));
      }
    });
  });
};

const resolveRange = (resolved: ResolvedNavigation, doc: Document): Range | null => {
  if (typeof resolved.anchor !== 'function') return null;
  try {
    const value = resolved.anchor(doc);
    return isRange(value) ? value : null;
  } catch {
    return null;
  }
};

const resultFailure = (reason: AnchorNavigationFailureReason): AnchorNavigationResult => ({
  status: 'not-found',
  reason,
});

const emptySession = (result: AnchorNavigationResult): AnchorNavigationSession => ({
  result,
  async returnToOrigin() {
    return false;
  },
  dispose() {},
});

export function createEpubAnchorNavigator(options: EpubAnchorNavigatorOptions): DocumentNavigator {
  const documentId = options.documentId.trim();
  if (!documentId) throw new Error('EpubAnchorNavigator requires a non-empty documentId');
  const timeoutMs = Math.max(1, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const highlightDurationMs = Math.max(
    0,
    options.highlightDurationMs ?? DEFAULT_HIGHLIGHT_DURATION_MS,
  );
  const highlightColor = options.highlightColor ?? DEFAULT_HIGHLIGHT_COLOR;
  const instanceId = ++navigatorCounter;
  let generation = 0;
  let disposed = false;
  let activeAbort: AbortController | null = null;
  let activeHighlight: ActiveHighlight | null = null;
  let activeSessionDisposer: (() => void) | null = null;
  let navigationQueue: Promise<void> = Promise.resolve();

  const clearHighlight = () => {
    const highlight = activeHighlight;
    activeHighlight = null;
    if (!highlight) return;
    clearTimeout(highlight.timer);
    highlight.overlayer.remove(highlight.key);
  };

  const enqueueNavigation = (
    runtime: EpubNavigationRuntime,
    target: string | number,
  ): Promise<unknown> => {
    const operation = navigationQueue.then(() => Promise.resolve(runtime.view.goTo(target)));
    navigationQueue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  };

  const navigateTo = async (
    runtime: EpubNavigationRuntime,
    target: string | number,
    index: number,
    signal: AbortSignal,
  ): Promise<EpubNavigationContent> => {
    const contentPromise = waitForRenderedContent(runtime, index, signal);
    const [, content] = await Promise.all([
      abortable(enqueueNavigation(runtime, target), signal),
      contentPromise,
    ]);
    throwIfAborted(signal);
    return content;
  };

  const addHighlight = (
    content: EpubNavigationContent,
    range: Range,
    currentGeneration: number,
  ) => {
    const overlayer = content.overlayer;
    if (!overlayer || highlightDurationMs === 0) return;
    clearHighlight();
    const key = `glossa-transient:${instanceId}:${currentGeneration}`;
    overlayer.add(key, range, Overlayer.highlight, { color: highlightColor });
    const timer = setTimeout(() => {
      if (activeHighlight?.key !== key) return;
      overlayer.remove(key);
      activeHighlight = null;
    }, highlightDurationMs);
    activeHighlight = { key, overlayer, timer };
  };

  const returnToOrigin = async (
    origin: OriginLocation,
    sessionRuntime: EpubNavigationRuntime,
    signal: AbortSignal,
  ): Promise<boolean> => {
    clearHighlight();
    if (disposed || options.getRuntime() !== sessionRuntime || origin.runtime !== sessionRuntime) {
      return false;
    }
    const targets: Array<string | number> = [];
    if (origin.cfi) targets.push(origin.cfi);
    if (origin.sectionHref && origin.sectionHref !== origin.cfi) targets.push(origin.sectionHref);
    if (origin.sectionIndex !== undefined) targets.push(origin.sectionIndex);
    for (const target of targets) {
      try {
        const resolved = sessionRuntime.view.resolveNavigation(target);
        if (!resolved || asInteger(resolved.index) === undefined) continue;
        await abortable(enqueueNavigation(sessionRuntime, target), signal);
        throwIfAborted(signal);
        if (renderedContent(sessionRuntime, resolved.index)) return true;
      } catch {
        if (signal.aborted) return false;
      }
    }
    if (origin.fraction !== undefined && sessionRuntime.view.goToFraction) {
      try {
        await abortable(Promise.resolve(sessionRuntime.view.goToFraction(origin.fraction)), signal);
        return !signal.aborted;
      } catch {
        return false;
      }
    }
    return false;
  };

  return {
    async navigate(value, navigationOptions = {}) {
      if (disposed) return emptySession(resultFailure('reader-unavailable'));
      const parsed = sourceAnchorSchema.safeParse(value);
      if (!parsed.success) return emptySession(resultFailure('invalid-anchor'));
      const anchor = parsed.data;
      if (anchor.documentId !== documentId) {
        return emptySession(resultFailure('document-mismatch'));
      }
      const runtime = options.getRuntime();
      if (!runtime) return emptySession(resultFailure('reader-unavailable'));

      generation++;
      const currentGeneration = generation;
      activeAbort?.abort();
      activeSessionDisposer?.();
      activeSessionDisposer = null;
      clearHighlight();
      const controller = new AbortController();
      activeAbort = controller;
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
      const onExternalAbort = () => controller.abort();
      navigationOptions.signal?.addEventListener('abort', onExternalAbort, { once: true });
      if (navigationOptions.signal?.aborted) controller.abort();
      const origin = captureOrigin(documentId, runtime);
      let result: AnchorNavigationResult = resultFailure('navigation-failed');
      let cfiSectionIndex: number | undefined;
      let sessionDisposed = false;
      let returnAttempted = false;

      try {
        throwIfAborted(controller.signal);
        if (anchor.cfi) {
          try {
            const resolved = runtime.view.resolveCFI(anchor.cfi);
            if (resolved && asInteger(resolved.index) !== undefined) {
              cfiSectionIndex = resolved.index;
              const content = await navigateTo(
                runtime,
                anchor.cfi,
                resolved.index,
                controller.signal,
              );
              const range = resolveRange(resolved, content.doc);
              if (
                range &&
                normalizeQuoteText(textFromEpubRange(range)) ===
                  normalizeQuoteText(anchor.quote.exact)
              ) {
                throwIfAborted(controller.signal);
                if (currentGeneration !== generation || disposed) throw abortError();
                addHighlight(content, range, currentGeneration);
                result = {
                  status: 'resolved',
                  method: 'cfi',
                  exact: true,
                  anchor,
                  canReturn: !!origin,
                };
              }
            }
          } catch (error) {
            if (controller.signal.aborted) throw error;
          }
        }

        if (result.status !== 'resolved') {
          const section = sectionTarget(runtime.view, anchor.sectionId, cfiSectionIndex);
          if (!section) {
            result = resultFailure('section-unavailable');
          } else {
            let content: EpubNavigationContent | null = null;
            try {
              content = await navigateTo(
                runtime,
                section.target,
                section.resolved.index,
                controller.signal,
              );
            } catch (error) {
              if (controller.signal.aborted) throw error;
              result = resultFailure('navigation-failed');
            }
            if (content) {
              const match = resolveEpubTextQuote(content.doc, anchor.quote);
              if (match.status === 'ambiguous') {
                result = resultFailure('ambiguous-quote');
              } else if (match.status === 'not-found') {
                result = {
                  status: 'resolved',
                  method: 'section',
                  exact: false,
                  anchor,
                  canReturn: !!origin,
                };
              } else {
                let recoveredCfi: string;
                try {
                  recoveredCfi = runtime.view.getCFI(section.resolved.index, match.range);
                  if (!recoveredCfi) throw new Error('Empty recovered CFI');
                  const finalContent = await navigateTo(
                    runtime,
                    recoveredCfi,
                    section.resolved.index,
                    controller.signal,
                  );
                  const recovered = runtime.view.resolveCFI(recoveredCfi);
                  const recoveredRange =
                    recovered && asInteger(recovered.index) === section.resolved.index
                      ? resolveRange(recovered, finalContent.doc)
                      : null;
                  if (
                    !recoveredRange ||
                    normalizeQuoteText(textFromEpubRange(recoveredRange)) !==
                      normalizeQuoteText(anchor.quote.exact)
                  ) {
                    throw new Error('Recovered TextQuote CFI did not resolve to the expected text');
                  }
                  throwIfAborted(controller.signal);
                  if (currentGeneration !== generation || disposed) throw abortError();
                  addHighlight(finalContent, recoveredRange, currentGeneration);
                  result = {
                    status: 'resolved',
                    method: 'text-quote',
                    exact: true,
                    anchor: { ...anchor, cfi: recoveredCfi },
                    canReturn: !!origin,
                  };
                } catch (error) {
                  if (controller.signal.aborted) throw error;
                  result = resultFailure('navigation-failed');
                }
              }
            }
          }
        }
      } catch {
        result = resultFailure(timedOut ? 'timeout' : 'aborted');
      } finally {
        clearTimeout(timeout);
        navigationOptions.signal?.removeEventListener('abort', onExternalAbort);
        if (activeAbort === controller) activeAbort = null;
      }

      const disposeSession = () => {
        if (sessionDisposed) return;
        sessionDisposed = true;
        if (activeSessionDisposer === disposeSession) activeSessionDisposer = null;
        if (currentGeneration === generation) clearHighlight();
      };
      activeSessionDisposer = disposeSession;
      return {
        result,
        async returnToOrigin() {
          if (sessionDisposed || returnAttempted || !origin || result.status !== 'resolved') {
            return false;
          }
          returnAttempted = true;
          return await returnToOrigin(origin, runtime, controller.signal);
        },
        dispose: disposeSession,
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      generation++;
      activeAbort?.abort();
      activeAbort = null;
      activeSessionDisposer?.();
      activeSessionDisposer = null;
      clearHighlight();
    },
  };
}
