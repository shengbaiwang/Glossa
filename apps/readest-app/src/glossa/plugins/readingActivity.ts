import { PLUGINS, isPluginEnabled, pluginSupportsFormat } from './registry';
import { pluginLoaders } from './loaders';
import { useBookDataStore } from '@/store/bookDataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useReaderStore } from '@/store/readerStore';
import type { AppService } from '@/types/system';
import type { FoliateView } from '@/types/view';
import type { ReadingActivity, ReadingSession, ReadingTimeClient } from './readingTime';

const manifest = PLUGINS.find(({ id }) => id === 'readingTime');
const books = new Map<string, ReadingSession>();
let client: ReadingTimeClient | undefined;

export function supportsReadingTime(app: AppService | null, format?: string) {
  return !!app?.isMacOSApp && (format === undefined || pluginSupportsFormat(manifest, format));
}

export function getReadingSession(bookKey: string) {
  return books.get(bookKey);
}

export function beginReadingSession(bookKey: string, bookHash: string) {
  const session = { bookHash, sessionId: crypto.randomUUID() };
  books.set(bookKey, session);
  return () => {
    if (books.get(bookKey) !== session) return;
    books.delete(bookKey);
    void client?.pause(session);
  };
}

export async function closeReadingSession(bookKey: string) {
  const session = books.get(bookKey);
  if (!session) return;
  books.delete(bookKey);
  await client?.pause(session);
}

export async function startReadingActivity(app: AppService, signal: AbortSignal) {
  const runtime = await pluginLoaders.readingTime();
  if (signal.aborted) return;
  const activeClient = runtime.getReadingTimeClient(app);
  client = activeClient;
  activeClient.start();

  const unsubscribe = useSettingsStore.subscribe((next, previous) => {
    if (next.isSettingsDialogOpen && !previous.isSettingsDialogOpen) void activeClient.pause();
  });
  signal.addEventListener(
    'abort',
    () => {
      unsubscribe();
      if (client === activeClient) client = undefined;
      void activeClient.stop();
    },
    { once: true },
  );
}

export function pauseReadingActivity() {
  void client?.pause();
}

export function reportReadingActivity(bookKey: string, kind: ReadingActivity) {
  if (!client) return;
  const state = useSettingsStore.getState();
  const session = books.get(bookKey);
  if (
    session &&
    !state.isSettingsDialogOpen &&
    isPluginEnabled(state.settings, 'readingTime') &&
    useReaderStore.getState().getViewState(bookKey)?.inited &&
    pluginSupportsFormat(
      manifest,
      useBookDataStore.getState().getBookData(bookKey)?.book?.format ?? '',
    )
  ) {
    client.signal(session, kind);
  }
}

const pageKeys = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'PageUp',
  'PageDown',
  ' ',
]);
const navigationReasons = new Set(['page', 'snap', 'scroll', 'container-scroll', 'navigation']);
const scrolledReasons = new Set(['scroll', 'container-scroll']);

/** Keep only transient evidence. The bridge never reads the selected text. */
export function observeReadingSurface(
  view: FoliateView,
  bookKey: string,
  isKeyboardBook: () => boolean,
  cell: HTMLElement | null,
  report = (kind: ReadingActivity) => reportReadingActivity(bookKey, kind),
) {
  const renderer = view.renderer;
  if (!renderer) return () => {};
  const lifetime = new AbortController();
  const docs = new Map<Document, AbortController>();
  const scrollRoots = new Map<EventTarget, AbortController>();
  const selections = new WeakMap<
    Document,
    {
      anchor: Node | null;
      focus: Node | null;
      start: number;
      end: number;
    }
  >();
  let selectionUntil = 0;
  let gesture: { kind: 'turn' | 'scroll' | 'key'; until: number } | undefined;
  let drag: { id: number; x: number; y: number } | undefined;
  let lastLocation = view.lastLocation?.cfi;
  let lastEmit = -Infinity;

  const emit = (kind: ReadingActivity) => {
    const now = performance.now();
    if (now - lastEmit < 350) return;
    lastEmit = now;
    report(kind);
  };
  const arm = (kind: NonNullable<typeof gesture>['kind']) => {
    gesture = { kind, until: performance.now() + 900 };
  };

  const wheel = (event: Event) => {
    const wheel = event as WheelEvent;
    if (
      wheel.isTrusted &&
      !wheel.ctrlKey &&
      !wheel.metaKey &&
      Math.abs(wheel.deltaX) + Math.abs(wheel.deltaY) >= 2
    )
      arm('scroll');
  };
  const key = (event: Event) => {
    const key = event as KeyboardEvent;
    const target = key.target as HTMLElement | null;
    if (
      !key.isTrusted ||
      key.defaultPrevented ||
      key.metaKey ||
      key.ctrlKey ||
      target?.closest?.('button, input, textarea, select, [contenteditable], [role="dialog"]')
    )
      return;
    if (pageKeys.has(key.key)) arm('key');
    if (key.shiftKey && pageKeys.has(key.key)) selectionUntil = performance.now() + 900;
  };
  const pointerDown = (event: Event) => {
    const p = event as PointerEvent;
    if (!p.isTrusted || !p.isPrimary) return;
    drag = { id: p.pointerId, x: p.clientX, y: p.clientY };
    selectionUntil = performance.now() + 900;
  };
  const pointerMove = (event: Event) => {
    const p = event as PointerEvent;
    if (
      !p.isTrusted ||
      (p.pointerType === 'mouse' && !p.buttons) ||
      !drag ||
      p.pointerId !== drag.id ||
      Math.hypot(p.clientX - drag.x, p.clientY - drag.y) < 8
    )
      return;
    drag = { id: p.pointerId, x: p.clientX, y: p.clientY };
    selectionUntil = performance.now() + 900;
    // A trusted drag can pan a PDF even in paginated mode. Movement alone
    // only arms the gesture and still requires scrolling or relocation.
    arm('scroll');
  };
  const pointerEnd = (event: Event) => {
    const p = event as PointerEvent;
    if (!p.isTrusted) return;
    drag = undefined;
    if (p.type === 'pointerup') selectionUntil = performance.now() + 900;
  };
  const click = (event: Event) => {
    if (event.isTrusted) arm('turn');
  };
  const addInput = (target: EventTarget, signal: AbortSignal, pageClick: boolean) => {
    const options = { capture: true, passive: true, signal };
    target.addEventListener('wheel', wheel, options);
    target.addEventListener('pointerdown', pointerDown, options);
    target.addEventListener('pointermove', pointerMove, options);
    target.addEventListener('pointerup', pointerEnd, options);
    target.addEventListener('pointercancel', pointerEnd, options);
    if (pageClick) target.addEventListener('click', click, options);
  };
  const scroll = (event: Event) => {
    // Scroll events are also emitted for programmatic moves. Require an
    // input from this particular surface, never a global mouse/keyboard tick.
    if (
      event.isTrusted &&
      gesture &&
      gesture.kind !== 'turn' &&
      performance.now() <= gesture.until
    ) {
      emit('scroll');
    }
  };
  const bindDocument = (doc: Document) => {
    if (docs.has(doc)) return;
    const scope = new AbortController();
    docs.set(doc, scope);
    const { signal } = scope;
    // Observe before the fixed-layout renderer consumes native Space and
    // pointer events for its pan gesture at the document's capture phase.
    const inputTarget = doc.defaultView ?? doc;
    addInput(inputTarget, signal, true);
    inputTarget.addEventListener('keydown', key, { capture: true, signal });
    doc.addEventListener('scroll', scroll, { capture: true, passive: true, signal });
    doc.addEventListener(
      'selectionchange',
      () => {
        const selected = doc.getSelection();
        if (!selected || selected.isCollapsed) {
          selections.delete(doc);
          return;
        }
        const next = {
          anchor: selected.anchorNode,
          focus: selected.focusNode,
          start: selected.anchorOffset,
          end: selected.focusOffset,
        };
        const previous = selections.get(doc);
        selections.set(doc, next);
        if (
          performance.now() <= selectionUntil &&
          (!previous ||
            previous.anchor !== next.anchor ||
            previous.focus !== next.focus ||
            previous.start !== next.start ||
            previous.end !== next.end)
        )
          emit('selection');
      },
      { signal },
    );
  };

  const rendererRoot = (renderer as unknown as HTMLElement).shadowRoot;
  const syncDocuments = (loaded?: Document) => {
    if (view.renderer !== renderer) return;
    const current = new Set(
      renderer
        .getContents()
        .map(({ doc }) => doc)
        .filter(Boolean),
    );
    if (loaded) current.add(loaded);
    for (const [doc, scope] of docs) {
      if (current.has(doc)) continue;
      scope.abort();
      docs.delete(doc);
    }
    const roots = new Set<EventTarget>();
    if (rendererRoot) roots.add(rendererRoot);
    for (const doc of current) {
      bindDocument(doc);
      const root = doc.defaultView?.frameElement?.getRootNode();
      if (root instanceof ShadowRoot) roots.add(root);
    }
    for (const [root, scope] of scrollRoots) {
      if (roots.has(root)) continue;
      scope.abort();
      scrollRoots.delete(root);
    }
    for (const root of roots) {
      if (scrollRoots.has(root)) continue;
      const scope = new AbortController();
      scrollRoots.set(root, scope);
      root.addEventListener('scroll', scroll, {
        capture: true,
        passive: true,
        signal: scope.signal,
      });
    }
  };

  const { signal } = lifetime;
  syncDocuments();
  addInput(view, signal, false);
  // Fixed layout can scroll the renderer host itself without relocating to
  // another CFI, for example while panning a zoomed PDF.
  renderer.addEventListener('scroll', scroll, { passive: true, signal });
  view.addEventListener('load', (event) => syncDocuments((event as CustomEvent).detail.doc), {
    signal,
  });
  const relocate = (event: Event) => {
    const { reason } = (event as CustomEvent).detail;
    const next = view.lastLocation?.cfi;
    const changed = next && next !== lastLocation;
    lastLocation = next;
    if (
      !changed ||
      !gesture ||
      performance.now() > gesture.until ||
      !navigationReasons.has(reason) ||
      (reason === 'navigation' && gesture.kind === 'scroll')
    )
      return;
    emit(scrolledReasons.has(reason) ? 'scroll' : 'turn');
    if (gesture.kind !== 'scroll') gesture = undefined;
  };
  // Foliate's public relocate event omits the renderer's reason. The renderer
  // dispatches after Foliate has updated lastLocation.
  renderer.addEventListener('relocate', relocate, { signal });
  document.addEventListener(
    'keydown',
    (event) => {
      if (isKeyboardBook()) key(event);
    },
    { capture: true, signal },
  );
  cell?.addEventListener(
    'click',
    (event) => {
      if ((event.target as Element | null)?.closest('[data-reading-turn] button:not(:disabled)'))
        click(event);
    },
    { capture: true, signal },
  );
  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.visibilityState === 'hidden') {
        gesture = undefined;
        selectionUntil = 0;
      }
    },
    { signal },
  );

  return () => {
    lifetime.abort();
    for (const scope of docs.values()) scope.abort();
    for (const scope of scrollRoots.values()) scope.abort();
  };
}
