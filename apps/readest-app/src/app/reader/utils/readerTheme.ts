import type { Renderer } from '@/types/view';
import type { ViewSettings } from '@/types/book';
import type { CustomFont } from '@/styles/fonts';
import {
  applyFixedlayoutStyles,
  applyScrollbarStyle,
  applyScrollModeClass,
  applyThemeModeClass,
  getStyles,
  type ThemeCode,
} from '@/utils/style';

export const applyReaderTheme = (
  renderer: Renderer,
  settings: ViewSettings,
  theme: ThemeCode,
  isFixedLayout: boolean,
  isPDF: boolean,
  fonts: CustomFont[],
) => {
  renderer.setStyles?.(getStyles(settings, theme, fonts));
  for (const { doc } of renderer.getContents()) {
    if (isFixedLayout) applyFixedlayoutStyles(doc, settings, theme);
    applyThemeModeClass(doc, theme.isDarkMode);
    applyScrollModeClass(doc, settings.scrolled || false);
  }
  applyScrollbarStyle(document, settings.hideScrollbar || false);
  if (isPDF) {
    const colors = settings.applyThemeToPDF
      ? { background: theme.bg, foreground: theme.fg }
      : undefined;
    // Reassigning pageColors re-renders PDF canvases, even when the colors are unchanged.
    if (
      colors?.background !== renderer.pageColors?.background ||
      colors?.foreground !== renderer.pageColors?.foreground
    ) {
      renderer.pageColors = colors;
    }
  }
};
