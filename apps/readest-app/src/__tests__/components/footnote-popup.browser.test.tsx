import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import type { BookDoc } from '@/libs/document';
import type { ViewSettings } from '@/types/book';
import type { FoliateView } from '@/types/view';
import { makeMarkdownBook } from '@/utils/md';
import { getStyles } from '@/utils/style';
import * as defaults from '@/services/constants';
import { eventDispatcher } from '@/utils/event';
import 'foliate-js/view.js';
import '@/styles/globals.css';
import '@/styles/glossa.css';

const state = vi.hoisted(() => ({
  reader: null as FoliateView | null,
  settings: {} as ViewSettings,
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({ getView: () => state.reader, getViewSettings: () => state.settings }),
}));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({ getBookData: () => ({ book: { primaryLanguage: 'en' } }) }),
}));
vi.mock('@/store/customFontStore', () => ({
  useCustomFontStore: () => ({ getLoadedFonts: () => [] }),
}));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: {} }) }));
const { default: FootnotePopup } = await import('@/app/reader/components/FootnotePopup');

let book: BookDoc;
let grid: HTMLDivElement;
const text = `${'这是一段用于验证注释换行和滚动体验的原创文字。'.repeat(60)} https://example.invalid/${'long-reference-'.repeat(30)} 注释结束。`;

const mountBook = async (note: string, extra = '') => {
  book = (await makeMarkdownBook(
    new File([`正文[^1]\n\n[^1]: ${note}\n${extra}`], 'original.md'),
  )) as unknown as BookDoc;
  state.reader = document.createElement('foliate-view') as FoliateView;
  grid.append(state.reader);
  await state.reader.open(book);
  state.reader.renderer.setStyles?.(getStyles(state.settings, undefined, []));
  await state.reader.goTo(0);
  render(<FootnotePopup bookKey='footnote-test' bookDoc={book} />);
};

// Sample painted frames instead of waiting past the initial layout shift.
const visibleFrames = async (open: () => void) => {
  const frames: { x: number; y: number; width: number; height: number }[] = [];
  let sampling = true;
  let prepared =
    document.querySelector('#popup-container')?.getAttribute('aria-hidden') !== 'false';
  const sample = () => {
    const popup = document.querySelector<HTMLElement>('#popup-container');
    if (popup?.getAttribute('aria-hidden') === 'true') prepared = true;
    if (
      prepared &&
      popup?.getAttribute('aria-hidden') === 'false' &&
      getComputedStyle(popup).visibility !== 'hidden'
    ) {
      const { x, y, width, height } = popup.getBoundingClientRect();
      frames.push({ x, y, width, height });
    }
    if (sampling) requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
  try {
    open();
    await waitFor(() => expect(frames.length).toBeGreaterThanOrEqual(16));
  } finally {
    sampling = false;
  }
  return frames;
};

beforeEach(async () => {
  await page.viewport(900, 700);
  // Viewport commands can resolve before the iframe's native resize event.
  // Let it settle before opening a note (real window resizing dismisses it).
  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  state.settings = {
    ...defaults.DEFAULT_BOOK_FONT,
    ...defaults.DEFAULT_BOOK_LAYOUT,
    ...defaults.DEFAULT_BOOK_STYLE,
    ...defaults.DEFAULT_BOOK_LANGUAGE,
    ...defaults.DEFAULT_VIEW_CONFIG,
    ...defaults.DEFAULT_TTS_CONFIG,
    ...defaults.DEFAULT_TRANSLATOR_CONFIG,
    ...defaults.DEFAULT_ANNOTATOR_CONFIG,
    ...defaults.DEFAULT_SCREEN_CONFIG,
    defaultFontSize: 24,
  } as ViewSettings;
  grid = document.createElement('div');
  grid.id = 'gridcell-footnote-test';
  grid.style.cssText = 'position:absolute;inset:0';
  document.body.append(grid);
  await mountBook(text);
});

it.each([
  60, 520,
])('shows a complete medium note at its final size from the first painted frame (anchor %ipx)', async (top) => {
  cleanup();
  state.reader!.close();
  state.reader!.remove();
  await book.destroy?.();
  await mountBook(
    '这是一则用于检验首次展开的原创注释，应当完整呈现，让读者可以连续阅读。'.repeat(4),
  );
  const source = state.reader!.renderer.getContents()[0]!.doc;
  const anchor = source.querySelector<HTMLAnchorElement>('a[role="doc-noteref"]')!;
  anchor.style.cssText = `position:fixed;top:${top}px;left:300px`;
  const frames = await visibleFrames(() => anchor.click());
  expect(frames[0]!.height).toBeGreaterThan(100);
  expect(frames.every((frame) => JSON.stringify(frame) === JSON.stringify(frames[0]))).toBe(true);
  const popup = document.querySelector<HTMLElement>('#popup-container')!;
  const note = popup.querySelector<FoliateView>('foliate-view')!;
  const viewport = note.renderer.shadowRoot!.querySelector<HTMLElement>('[part~="container"]')!;
  expect(viewport.scrollHeight).toBeLessThanOrEqual(viewport.clientHeight + 1);
  expect(frames[0]!.y).toBeGreaterThanOrEqual(0);
  expect(frames[0]!.y + frames[0]!.height).toBeLessThanOrEqual(700);
  await page.screenshot({ path: `../../../../../.glossa-dev/qa/footnote-stable-${top}.png` });
});

afterEach(async () => {
  cleanup();
  state.reader?.close();
  grid.remove();
  await book?.destroy?.();
  for (const attribute of ['data-theme', 'data-eink', 'dir'])
    document.documentElement.removeAttribute(attribute);
  localStorage.removeItem('themeMode');
});

const openNote = async () => {
  const source = state.reader!.renderer.getContents()[0]!.doc;
  const anchor = source.querySelector<HTMLAnchorElement>('a[role="doc-noteref"]')!;
  anchor.click();
  await waitFor(() =>
    expect(document.querySelector('#popup-container')?.getAttribute('aria-hidden')).toBe('false'),
  );
  const popup = document.querySelector<HTMLElement>('#popup-container')!;
  await waitFor(() => expect(popup.getBoundingClientRect().left).toBeGreaterThanOrEqual(0));
  const view = popup.querySelector<FoliateView>('foliate-view')!;
  const viewport = view.renderer.shadowRoot!.querySelector<HTMLElement>('[part~="container"]')!;
  await waitFor(() =>
    state.settings.vertical
      ? expect(viewport.scrollWidth).toBeGreaterThan(viewport.clientWidth)
      : expect(viewport.scrollHeight).toBeGreaterThan(viewport.clientHeight),
  );
  return { popup, view, viewport };
};

it('fits a long note to the popup without outer scrollbars or sideways text overflow', async () => {
  const { popup, view, viewport } = await openNote();
  const doc = view.renderer.getContents()[0]!.doc;
  expect(popup.scrollWidth).toBeLessThanOrEqual(popup.clientWidth);
  expect(popup.scrollHeight).toBeLessThanOrEqual(popup.clientHeight);
  expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.clientWidth + 1);
  expect(doc.documentElement.scrollWidth).toBeLessThanOrEqual(doc.documentElement.clientWidth + 1);
  expect(doc.body.textContent).toContain('注释结束。');
});

it('keeps a long note fixed while scrolling and reveals it without resizing', async () => {
  const source = state.reader!.renderer.getContents()[0]!.doc;
  const anchor = source.querySelector<HTMLAnchorElement>('a[role="doc-noteref"]')!;
  const frames = await visibleFrames(() => anchor.click());
  expect(frames.every((frame) => JSON.stringify(frame) === JSON.stringify(frames[0]))).toBe(true);
  const popup = document.querySelector<HTMLElement>('#popup-container')!;
  await userEvent.wheel(popup, { delta: { y: 250 } });
  const { x, y, width, height } = popup.getBoundingClientRect();
  expect({ x, y, width, height }).toEqual(frames[0]);
});

it('cancels pending layout on Escape and allows a fresh note to open', async () => {
  const source = state.reader!.renderer.getContents()[0]!.doc;
  const anchor = source.querySelector<HTMLAnchorElement>('a[role="doc-noteref"]')!;
  anchor.click();
  await waitFor(() =>
    expect(document.querySelector('[data-capture-blocking-overlay]')).not.toBeNull(),
  );
  await userEvent.keyboard('{Escape}');
  // Wait beyond the hidden measurement frames; a late result must stay closed.
  for (let frame = 0; frame < 20; frame++) await new Promise(requestAnimationFrame);
  expect(document.querySelector('#popup-container')?.getAttribute('aria-hidden')).toBe('true');
  expect(document.querySelector('[data-capture-blocking-overlay]')).toBeNull();
  await openNote();
});

it('lays out nested notes and Back without exposing provisional sizes', async () => {
  cleanup();
  state.reader!.close();
  state.reader!.remove();
  await book.destroy?.();
  await mountBook('第一则注释。继续阅读[^2]', '\n[^2]: 这是第二则原创注释。');
  const source = state.reader!.renderer.getContents()[0]!.doc;
  const anchor = source.querySelector<HTMLAnchorElement>('a[role="doc-noteref"]')!;
  await visibleFrames(() => anchor.click());
  const popup = document.querySelector<HTMLElement>('#popup-container')!;
  let note = popup.querySelector<FoliateView>('foliate-view')!;
  const link = note.renderer
    .getContents()[0]!
    .doc.querySelector<HTMLAnchorElement>('a[role="doc-noteref"]')!;
  const nestedFrames = await visibleFrames(() => link.click());
  expect(nestedFrames).toEqual(nestedFrames.map(() => nestedFrames[0]));
  note = popup.querySelector<FoliateView>('foliate-view')!;
  expect(note.renderer.getContents()[0]!.doc.body.textContent).toContain('第二则原创注释');
  const back = popup.querySelector<HTMLButtonElement>('button')!;
  const backFrames = await visibleFrames(() => back.click());
  expect(backFrames.every((frame) => JSON.stringify(frame) === JSON.stringify(backFrames[0]))).toBe(
    true,
  );
  note = popup.querySelector<FoliateView>('foliate-view')!;
  expect(note.renderer.getContents()[0]!.doc.body.textContent).toContain('第一则注释');
});

it('waits for the note fonts before its first visible frame', async () => {
  let releaseFonts!: () => void;
  const fontsReady = new Promise<void>((resolve) => {
    releaseFonts = resolve;
  });
  let waiting = false;
  const observer = new MutationObserver(() => {
    const note = document.querySelector<FoliateView>('.footnote-content foliate-view');
    note?.addEventListener(
      'load',
      ((event: CustomEvent<{ doc: Document }>) => {
        Object.defineProperty(event.detail.doc.fonts, 'ready', {
          value: fontsReady,
          configurable: true,
        });
        waiting = true;
      }) as EventListener,
      { once: true },
    );
  });
  observer.observe(document.querySelector('.footnote-content')!, { childList: true });
  try {
    const source = state.reader!.renderer.getContents()[0]!.doc;
    source.querySelector<HTMLAnchorElement>('a[role="doc-noteref"]')!.click();
    await waitFor(() => expect(waiting).toBe(true));
    for (let frame = 0; frame < 8; frame++) await new Promise(requestAnimationFrame);
    expect(document.querySelector('#popup-container')?.getAttribute('aria-hidden')).toBe('true');
    const frames = await visibleFrames(releaseFonts);
    expect(frames.every((frame) => JSON.stringify(frame) === JSON.stringify(frames[0]))).toBe(true);
  } finally {
    releaseFonts();
    observer.disconnect();
  }
});

it('shows a complete plain text note once, using the reading font', async () => {
  const source = state.reader!.renderer.getContents()[0]!.doc;
  const element = source.querySelector<HTMLAnchorElement>('a[role="doc-noteref"]')!;
  const noteText = '普通文字注释同样应当直接完整显示，便于连贯阅读。'.repeat(4);
  const frames = await visibleFrames(() => {
    void eventDispatcher.dispatch('footnote-popup', { element, footnote: noteText });
  });
  expect(frames[0]!.height).toBeGreaterThan(100);
  expect(frames.every((frame) => JSON.stringify(frame) === JSON.stringify(frames[0]))).toBe(true);
  const paragraph = document.querySelector<HTMLElement>('.footnote-text')!;
  expect(paragraph.scrollHeight).toBeLessThanOrEqual(paragraph.clientHeight + 1);
  expect(getComputedStyle(paragraph).fontSize).toBe('24px');
});

it('still opens plain text notes with a fallback when a reading font fails', async () => {
  const fontLoad = vi
    .spyOn(document.fonts, 'load')
    .mockRejectedValueOnce(new Error('Missing local font'));
  try {
    const source = state.reader!.renderer.getContents()[0]!.doc;
    const element = source.querySelector<HTMLAnchorElement>('a[role="doc-noteref"]')!;
    await visibleFrames(() => {
      void eventDispatcher.dispatch('footnote-popup', {
        element,
        footnote: '字体回退时，注释仍然可读。',
      });
    });
    expect(document.querySelector('.footnote-text')?.textContent).toBe(
      '字体回退时，注释仍然可读。',
    );
  } finally {
    fontLoad.mockRestore();
  }
});

it('keeps the idle scrollbar quiet and reveals it on hover and keyboard scrolling', async () => {
  const { popup, viewport } = await openNote();
  viewport.blur();
  const outside = document.createElement('div');
  outside.style.cssText = 'position:fixed;left:0;top:0;width:8px;height:8px;z-index:100';
  document.body.append(outside);
  await userEvent.hover(outside);
  outside.remove();
  expect(popup.querySelector('.footnote-content')!.matches(':hover')).toBe(false);
  expect(viewport.matches(':focus-visible')).toBe(false);
  await waitFor(() =>
    expect(getComputedStyle(viewport).scrollbarColor).toBe('rgba(0, 0, 0, 0) rgba(0, 0, 0, 0)'),
  );
  await userEvent.hover(popup);
  expect(getComputedStyle(viewport).scrollbarColor).not.toBe('rgba(0, 0, 0, 0) rgba(0, 0, 0, 0)');
  await userEvent.wheel(popup, { delta: { y: 160 } });
  await waitFor(() => expect(viewport.scrollTop).toBeGreaterThan(0));
  document.body.append(outside);
  await userEvent.hover(outside);
  outside.remove();
  await waitFor(
    () =>
      expect(getComputedStyle(viewport).scrollbarColor).toBe('rgba(0, 0, 0, 0) rgba(0, 0, 0, 0)'),
    { timeout: 2000 },
  );
  viewport.focus();
  await userEvent.keyboard('{PageDown}');
  await waitFor(() => expect(viewport.scrollTop).toBeGreaterThan(0));
  await userEvent.keyboard('{End}');
  await waitFor(() =>
    expect(viewport.scrollTop + viewport.clientHeight).toBeGreaterThanOrEqual(
      viewport.scrollHeight - 1,
    ),
  );
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(popup.getAttribute('aria-hidden')).toBe('true'));
});

it.each([
  ['light', 900, 'ltr', false],
  ['dark', 390, 'rtl', false],
  ['light', 390, 'ltr', true],
] as const)('keeps long notes readable in %s at %ipx (%s, e-ink %s)', async (theme, width, direction, eink) => {
  await page.viewport(width, 700);
  document.documentElement.setAttribute('data-theme', `default-${theme}`);
  localStorage.setItem('themeMode', theme);
  document.documentElement.setAttribute('dir', direction);
  document.documentElement.setAttribute('data-eink', String(eink));
  const { popup, viewport } = await openNote();
  expect(popup.getBoundingClientRect().left).toBeGreaterThanOrEqual(0);
  expect(popup.getBoundingClientRect().right).toBeLessThanOrEqual(width);
  expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.clientWidth + 1);
  await userEvent.wheel(popup, { delta: { y: 200 } });
  await waitFor(() => expect(viewport.scrollTop).toBeGreaterThan(0));
  expect(state.reader!.renderer.atStart).toBe(true);
  await page.screenshot({
    path: `../../../../../.glossa-dev/qa/footnote-${theme}-${width}-${eink}.png`,
  });
});

it('uses the same single, keyboard-scrollable viewport for plain text notes', async () => {
  const source = state.reader!.renderer.getContents()[0]!.doc;
  const element = source.querySelector<HTMLAnchorElement>('a[role="doc-noteref"]')!;
  await eventDispatcher.dispatch('footnote-popup', { element, footnote: text });
  const popup = document.querySelector<HTMLElement>('#popup-container')!;
  const paragraph = popup.querySelector<HTMLElement>('.footnote-text')!;
  await waitFor(() => expect(popup.getAttribute('aria-hidden')).toBe('false'));
  expect(popup.scrollWidth).toBeLessThanOrEqual(popup.clientWidth);
  expect(popup.scrollHeight).toBeLessThanOrEqual(popup.clientHeight);
  expect(paragraph.scrollWidth).toBeLessThanOrEqual(paragraph.clientWidth);
  expect(paragraph.textContent).toBe(text);
  await userEvent.keyboard('{End}');
  await waitFor(() => expect(paragraph.scrollTop).toBeGreaterThan(0));
});

it('preserves the primary scroll direction for vertical reading', async () => {
  state.settings.vertical = true;
  state.settings.writingMode = 'vertical-rl';
  const { popup, view, viewport } = await openNote();
  const doc = view.renderer.getContents()[0]!.doc;
  expect(doc.defaultView!.getComputedStyle(doc.body).writingMode).toBe('vertical-rl');
  expect(popup.scrollWidth).toBeLessThanOrEqual(popup.clientWidth);
  expect(getComputedStyle(viewport).overflowX).toBe('auto');
  expect(viewport.scrollWidth).toBeGreaterThan(viewport.clientWidth);
});
