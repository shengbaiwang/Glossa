import { afterEach, expect, it } from 'vitest';
import { DocumentLoader, type BookDoc } from '@/libs/document';
import { applyReaderTheme } from '@/app/reader/utils/readerTheme';
import { getDefaultViewSettings, type Context } from '@/services/settingsService';
import { getThemeCode } from '@/utils/style';
import type { FoliateView } from '@/types/view';
import 'foliate-js/view.js';

let view: FoliateView | undefined;
let bookDoc: BookDoc | undefined;
afterEach(async () => {
  view?.close();
  view?.remove();
  view = undefined;
  await bookDoc?.destroy?.();
  bookDoc = undefined;
});

for (const format of ['epub', 'pdf'] as const) {
  it(`updates real ${format.toUpperCase()} documents and keeps the theme on subsequent pages`, async () => {
    const bytes = await (
      await fetch(new URL(`../../fixtures/data/glossa-reading-sample.${format}`, import.meta.url))
    ).arrayBuffer();
    const { book } = await new DocumentLoader(new File([bytes], `original.${format}`)).open();
    bookDoc = book;
    view = document.createElement('foliate-view') as FoliateView;
    view.style.cssText = 'display:block;width:700px;height:500px';
    document.body.append(view);
    await view.open(book);
    const fixed = format === 'pdf';
    const settings = {
      ...getDefaultViewSettings({ isMobile: false, isEink: false } as Context),
      applyThemeToPDF: true,
    };
    const light = getThemeCode('default', false);
    const dark = getThemeCode('sepia', true);
    // Apply colors before initial navigation, as FoliateViewer does.
    applyReaderTheme(view.renderer, settings, light, fixed, fixed, []);
    await view.goTo(0);
    const initialCfi = view.lastLocation!.cfi;
    applyReaderTheme(view.renderer, settings, dark, fixed, fixed, []);
    for (const { doc } of view.renderer.getContents()) {
      expect(doc.body.classList.contains('theme-dark')).toBe(true);
      expect(getComputedStyle(doc.documentElement).colorScheme).toBe('dark');
      expect(
        getComputedStyle(doc.documentElement).getPropertyValue('--theme-bg-color').trim(),
      ).toBe(dark.bg);
    }
    expect(view.lastLocation!.cfi).toBe(initialCfi);
    if (fixed)
      expect(view.renderer.pageColors).toEqual({ background: dark.bg, foreground: dark.fg });
    await view.goTo(1);
    if (fixed) applyReaderTheme(view.renderer, settings, dark, true, true, []);
    const next = view.renderer.getContents().find(({ index }) => index === 1)!.doc;
    expect(getComputedStyle(next.documentElement).colorScheme).toBe('dark');
    applyReaderTheme(view.renderer, settings, light, fixed, fixed, []);
    expect(getComputedStyle(next.documentElement).colorScheme).toBe('light');
    expect(next.body.classList.contains('theme-light')).toBe(true);
  }, 30_000);
}
