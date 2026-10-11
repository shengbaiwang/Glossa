import { beforeEach, expect, it, vi } from 'vitest';
import { applyReaderTheme } from '@/app/reader/utils/readerTheme';
import { getThemeCode } from '@/utils/style';
import { getDefaultViewSettings, type Context } from '@/services/settingsService';
import type { Renderer } from '@/types/view';

beforeEach(() => localStorage.clear());
// Theme styling only consumes view defaults, without filesystem access.
const settingsContext = { isMobile: false, isEink: false } as Context;

it('uses the supplied live palette for all loaded reading documents', () => {
  const docs = [
    document.implementation.createHTMLDocument(),
    document.implementation.createHTMLDocument(),
  ];
  const setStyles = vi.fn();
  const renderer = Object.assign(document.createElement('div'), {
    setStyles,
    getContents: () => docs.map((doc) => ({ doc })),
  }) as unknown as Renderer;
  const darkTheme = getThemeCode('sepia', true);
  applyReaderTheme(renderer, getDefaultViewSettings(settingsContext), darkTheme, false, false, []);
  expect(setStyles).toHaveBeenCalledOnce();
  expect(setStyles.mock.calls[0]![0]).toContain(`--theme-bg-color: ${darkTheme.bg}`);
  expect(docs.every((doc) => doc.body.classList.contains('theme-dark'))).toBe(true);
});

it('updates fixed-layout colors and only repaints the PDF canvas when its colors change', () => {
  const doc = document.implementation.createHTMLDocument();
  const renderer = Object.assign(document.createElement('div'), {
    getContents: () => [{ doc }],
  }) as unknown as Renderer;
  let colors: Renderer['pageColors'];
  const repaint = vi.fn();
  Object.defineProperty(renderer, 'pageColors', {
    get: () => colors,
    set: (next: Renderer['pageColors']) => {
      colors = next;
      repaint();
    },
  });
  const settings = { ...getDefaultViewSettings(settingsContext), applyThemeToPDF: true };
  const darkTheme = getThemeCode('sepia', true);
  applyReaderTheme(renderer, settings, darkTheme, true, true, []);
  applyReaderTheme(renderer, settings, darkTheme, true, true, []);
  expect(repaint).toHaveBeenCalledOnce();
  expect(doc.getElementById('fixed-layout-styles')!.textContent).toContain('color-scheme: dark');
  expect(colors).toEqual({ background: darkTheme.bg, foreground: darkTheme.fg });
  applyReaderTheme(renderer, { ...settings, applyThemeToPDF: false }, darkTheme, true, true, []);
  expect(colors).toBeUndefined();
  expect(repaint).toHaveBeenCalledTimes(2);
});
