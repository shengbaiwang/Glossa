import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import 'foliate-js/view.js';
import { makeMarkdownBook } from '@/utils/md';
import type { BookDoc } from '@/libs/document';
import { wrappedFoliateView, type FoliateView } from '@/types/view';
import type { BookConfig, BookNote, ViewSettings } from '@/types/book';
import * as defaults from '@/services/constants';
import { getStyles } from '@/utils/style';
import Annotator from '@/app/reader/components/annotator/Annotator';
import '@/styles/globals.css';
import '@/styles/glossa.css';
import '@/styles/glossa-reader.css';

let view: FoliateView;
let book: BookDoc;
const config: BookConfig = { updatedAt: 0, booknotes: [] };
const viewSettings = {
  ...defaults.DEFAULT_BOOK_FONT,
  ...defaults.DEFAULT_BOOK_LAYOUT,
  ...defaults.DEFAULT_BOOK_STYLE,
  ...defaults.DEFAULT_BOOK_LANGUAGE,
  ...defaults.DEFAULT_VIEW_CONFIG,
  ...defaults.DEFAULT_TTS_CONFIG,
  ...defaults.DEFAULT_TRANSLATOR_CONFIG,
  ...defaults.DEFAULT_ANNOTATOR_CONFIG,
  ...defaults.DEFAULT_SCREEN_CONFIG,
  scrolled: true,
  annotationToolbarItems: ['copy', 'highlight', 'annotate'],
  enableAnnotationQuickActions: false,
} as ViewSettings;
const dataState = {
  getBookData: () => ({ book: { format: 'MD' }, isFixedLayout: false, bookDoc: book }),
  getConfig: () => config,
  setConfig: vi.fn(),
  saveConfig: vi.fn(async () => {}),
  updateBooknotes: vi.fn((_key: string, notes: BookNote[]) => {
    config.booknotes = notes;
    return config;
  }),
};
const readerState = {
  getView: () => view,
  getViewsById: () => [view],
  getViewSettings: () => viewSettings,
  getProgress: () => ({ page: 1 }),
};
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: { isMobile: false, isAndroidApp: false } }),
}));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: (select?: (state: typeof dataState) => unknown) =>
    select ? select(dataState) : dataState,
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: (select?: (state: typeof readerState) => unknown) =>
    select ? select(readerState) : readerState,
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: { globalReadSettings: defaults.DEFAULT_READSETTINGS, globalViewSettings: {} },
  }),
}));
vi.mock('@/store/themeStore', () => ({ useThemeStore: () => ({ isDarkMode: false }) }));
vi.mock('@/store/readerProgressStore', () => ({
  useBookProgress: () => undefined,
  getBookProgress: () => ({ page: 1 }),
}));
vi.mock('@/app/reader/hooks/useNotesSync', () => ({ useNotesSync: () => {} }));
const original =
  '# Original methods\n\nOriginal evidence supports the conclusion.\n\n## Conditions\n\nThe conclusion depends on the conditions.\n\n# Results\n\n' +
  Array.from(
    { length: 24 },
    (_, i) => `Result ${i + 1} remains separately available and can be read independently.`,
  ).join('\n\n');
afterEach(async () => {
  cleanup();
  view?.close();
  view?.remove();
  await book?.destroy?.();
  config.booknotes = [];
  vi.clearAllMocks();
});
async function open() {
  await page.viewport(1000, 900);
  book = await makeMarkdownBook(new File([original], 'Original.md'));
  view = wrappedFoliateView(document.createElement('foliate-view') as FoliateView);
  view.style.cssText = 'display:block;width:620px;height:800px';
  await view.open(book);
  render(
    <div id='gridcell-original' style={{ width: 620, height: 800, position: 'relative' }}>
      <div
        ref={(element) => {
          element?.append(view);
        }}
      />
      <Annotator bookKey='original' contentInsets={{ top: 0, bottom: 0, left: 0, right: 0 }} />
    </div>,
  );
  view.renderer.setAttribute('flow', 'scrolled');
  view.renderer.setStyles?.(getStyles(viewSettings, undefined, []));
  await view.goTo(book.toc![0]!.href);
  return view.renderer.getContents().find((content) => content.index === 0)!.doc;
}
it('creates a Markdown highlight with the real selection toolbar and restores it with a personal note', async () => {
  const doc = await open();
  const range = doc.createRange();
  range.selectNodeContents(doc.querySelector('p')!);
  const rect = range.getBoundingClientRect();
  const frame = doc.defaultView!.frameElement!.getBoundingClientRect();
  await commands.dragPDFText(
    { x: frame.left + rect.left + 0.2, y: frame.top + rect.top + rect.height / 2 },
    { x: frame.left + rect.right - 0.2, y: frame.top + rect.top + rect.height / 2 },
  );
  await expect.poll(() => !!document.querySelector('.selection-popup')).toBe(true);
  const text = doc.getSelection()!.toString();
  expect(text).toContain('Original evidence');
  await userEvent.click(screen.getByRole('button', { name: 'Highlight' }));
  await waitFor(() => expect(config.booknotes).toHaveLength(1));
  config.booknotes![0]!.note = 'Personal interpretation to preserve';
  const saved = structuredClone(config.booknotes![0]!);
  expect(saved.text).toBe(text);
  expect(dataState.saveConfig).toHaveBeenCalled();
  view.deselect();
  const location = view.lastLocation!.cfi!;
  cleanup();
  view.close();
  view.remove();
  await book.destroy?.();
  await open();
  await view.goTo(location);
  const targetDoc = view.renderer.getContents().find((content) => content.index === 0)!.doc;
  const restored = view.resolveCFI(saved.cfi)!.anchor(targetDoc) as Range;
  expect(restored.toString()).toBe(saved.text);
  expect(config.booknotes).toEqual([saved]);
  await expect
    .poll(() => {
      const content = view.renderer.getContents().find((item) => item.index === 0);
      return (
        (content?.overlayer as { element: SVGElement } | undefined)?.element.querySelectorAll(
          'g[fill] path',
        ).length ?? 0
      );
    })
    .toBeGreaterThan(0);
  // In continuous flow the heading can share a viewport with the preceding
  // section. Move into the body so relocation unambiguously reports Results.
  await expect
    .poll(() => view.renderer.getContents().find((item) => item.index === 1)?.doc.body.textContent)
    .toContain('Result 24');
  await view.renderer.goTo({ index: 1, anchor: 0.5 });
  await expect.poll(() => view.resolveCFI(view.lastLocation!.cfi!).index).toBe(1);
  await view.goTo(saved.cfi);
  // The short first section shares the viewport with Results, whose centre
  // can remain current. Verify the saved words are visibly reached instead.
  await expect
    .poll(() => {
      const content = view.renderer.getContents().find((item) => item.index === 0)!;
      const range = view.resolveCFI(saved.cfi)!.anchor(content.doc) as Range;
      const rect = range.getBoundingClientRect();
      const frameRect = content.doc.defaultView!.frameElement!.getBoundingClientRect();
      const viewRect = view.getBoundingClientRect();
      return (
        rect.top + frameRect.top >= viewRect.top - 1 &&
        rect.bottom + frameRect.top <= viewRect.bottom
      );
    })
    .toBe(true);
  await page.screenshot({ path: '../../../../../.glossa-dev/qa/markdown/annotation-restored.png' });
});
