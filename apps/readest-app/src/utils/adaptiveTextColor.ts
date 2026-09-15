import tinycolor from 'tinycolor2';
import { CustomTheme, generateDarkPalette, themes } from '@/styles/themes';

/**
 * Dark-mode adaptive text colors for book content.
 *
 * Book text colors that are hard to read on the dark page (dark grays, navy,
 * maroon, ...) are wrapped as `light-dark(original, adapted)`: the light
 * branch keeps the original book color untouched, the dark branch lifts it.
 * Because the reader sets `color-scheme` and the `--theme-*` variables on the
 * book iframe's `html`, the wrapped value follows theme switches live without
 * re-transforming the section. Engines without `light-dark()` drop the
 * declaration and inherit the readable theme foreground — never worse.
 */

/** Theme dark-palette anchors used for contrast decisions. */
export interface DarkPalette {
  bg: string;
  fg: string;
}

/**
 * Background analysis of a declaration block (stylesheet rule body or inline
 * style attribute). 'theme' = the text sits on the theme page background
 * (either no background is declared, or a light one that gets wrapped to the
 * theme background in dark mode); 'color' = the text sits on its own kept
 * dark background; 'never' = the background is mid-tone, translucent, an
 * image/gradient, or unparseable — lifting text there could make it worse.
 */
export type BlockBackground =
  | { kind: 'theme' }
  | { kind: 'color'; color: string }
  | { kind: 'never' };

/** True for #fff, #f5f5f5, rgb(255,…), etc. Used when rewriting EPUB CSS in dark mode. */
export const isLightCssColor = (value: string): boolean => {
  const v = value.trim().toLowerCase();
  if (v === 'white') return true;
  const hex = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const h = hex[1]!;
    const expand =
      h.length === 3
        ? h
            .split('')
            .map((c) => c + c)
            .join('')
        : h;
    const r = parseInt(expand.slice(0, 2), 16);
    const g = parseInt(expand.slice(2, 4), 16);
    const b = parseInt(expand.slice(4, 6), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.85;
  }
  const rgb = v.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/);
  if (rgb?.[1] != null && rgb[2] != null && rgb[3] != null) {
    const r = parseInt(rgb[1], 10);
    const g = parseInt(rgb[2], 10);
    const b = parseInt(rgb[3], 10);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.85;
  }
  return false;
};

/**
 * The dark palette of the *current theme color*, regardless of whether the
 * app is currently in light or dark mode. Adaptation decisions must not
 * depend on the mode at transform time: the wrapped light-dark() values are
 * baked into the loaded section and switch live with `color-scheme`.
 */
export const getThemeDarkPalette = (): DarkPalette => {
  const fallback = () => ({
    bg: themes[0]!.colors.dark['base-100'],
    fg: themes[0]!.colors.dark['base-content'],
  });
  try {
    const themeColor =
      (typeof window !== 'undefined' && localStorage.getItem('themeColor')) || 'default';
    const builtin = themes.find((theme) => theme.name === themeColor);
    if (builtin) {
      return { bg: builtin.colors.dark['base-100'], fg: builtin.colors.dark['base-content'] };
    }
    const customThemes: CustomTheme[] =
      typeof window !== 'undefined' ? JSON.parse(localStorage.getItem('customThemes') || '[]') : [];
    const custom = customThemes.find((theme) => theme.name === themeColor);
    if (custom) {
      const dark = generateDarkPalette(custom.colors.dark);
      return { bg: dark['base-100'], fg: dark['base-content'] };
    }
  } catch {
    // Corrupt localStorage: fall back to the default dark palette.
  }
  return fallback();
};

// Fresh regex instances per call: shared /g regexes carry lastIndex state.
const bgDeclRe = () =>
  /(^|[\s;{])background(?:-color)?\s*:\s*([^;!}]+?)(\s*!important)?(?=\s*(?:[;!}]|$))/gi;
const colorDeclRe = () => /(^|[\s;{])color\s*:\s*([^;!}]+?)(\s*!important)?(?=\s*(?:[;!}]|$))/gi;

/** Values that already adapt to the theme or are engine-computed. */
const ADAPTIVE_VALUE_RE = /\b(?:var|color-mix|light-dark)\s*\(/i;
/** Backgrounds we must not flatten or reason about statically. */
const COMPLEX_BACKGROUND_RE = /url\(|gradient\(|image\(|\b(?:var|color-mix|light-dark)\s*\(/i;
const CSS_KEYWORD_RE = /^(?:inherit|initial|unset|revert(?:-layer)?|currentcolor|transparent)$/i;

/** WCAG contrast ratio between two parseable CSS colors. */
const contrastRatio = (a: string, b: string): number => {
  const la = tinycolor(a).getLuminance();
  const lb = tinycolor(b).getLuminance();
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

/** Minimum contrast for body-size text on the dark page (WCAG AA). */
const MIN_CONTRAST = 4.5;
/** A kept background darker than this counts as a dark surface. */
const DARK_SURFACE_LUMINANCE = 0.35;

export const analyzeBlockBackground = (block: string): BlockBackground => {
  const decls = [...block.matchAll(bgDeclRe())];
  if (!decls.length) return { kind: 'theme' };
  // Within one block the last background declaration wins.
  const value = decls.at(-1)![2]!.trim();
  if (COMPLEX_BACKGROUND_RE.test(value)) return { kind: 'never' };
  const token = value.split(/\s+/)[0]!;
  const color = tinycolor(token);
  if (!color.isValid()) return { kind: 'never' };
  // Light backgrounds are wrapped to the theme background in dark mode, so
  // the text effectively sits on the theme page there.
  if (isLightCssColor(token)) return { kind: 'theme' };
  if (color.getAlpha() < 1) return { kind: 'never' };
  return color.getLuminance() < DARK_SURFACE_LUMINANCE
    ? { kind: 'color', color: token }
    : { kind: 'never' };
};

/**
 * Returns the `light-dark(original, adapted)` replacement for a book text
 * color, or null when the color should stay as-is (already readable on the
 * effective background, or adapting could make it worse).
 *
 * - Achromatic darks (black/gray body text and notes) become a theme-anchored
 *   warm white/light gray; the mix ratio follows the original luminance so
 *   the book's emphasis order survives (body strongest, notes slightly
 *   dimmer but still clearly readable).
 * - Chromatic darks (navy/green/maroon headings) are mixed with white in
 *   oklch, where white's hue is powerless: the original hue survives while
 *   lightness rises and chroma softens to a gentle bright tone.
 */
export const adaptTextColorForDark = (
  raw: string,
  dark: DarkPalette,
  blockBg: BlockBackground = { kind: 'theme' },
): string | null => {
  const value = raw.trim();
  if (!value || CSS_KEYWORD_RE.test(value) || ADAPTIVE_VALUE_RE.test(value)) return null;
  if (blockBg.kind === 'never') return null;
  const color = tinycolor(value);
  if (!color.isValid() || color.getAlpha() === 0) return null;
  const bg = blockBg.kind === 'color' ? blockBg.color : dark.bg;
  if (contrastRatio(value, bg) >= MIN_CONTRAST) return null;
  const alpha = color.getAlpha();
  if (color.toHsv().s < 0.08) {
    const t = Math.min(color.getLuminance() / 0.18, 1);
    const ratio = Math.round((100 - t * 30) * alpha);
    return `light-dark(${value}, color-mix(in srgb, var(--theme-fg-color) ${ratio}%, var(--theme-bg-color)))`;
  }
  // Translucent chromatic text composites unpredictably; leave it alone.
  if (alpha < 0.99) return null;
  return `light-dark(${value}, color-mix(in oklch, ${value} 45%, white))`;
};

/**
 * Rewrites a declaration block (a stylesheet rule body including its braces,
 * or a bare inline-style declaration list) for dark-mode adaptation:
 *
 * 1. Pure-color light backgrounds are wrapped as
 *    `background-color: light-dark(original, var(--theme-bg-color))` so the
 *    surface and its text switch together; backgrounds with images/gradients
 *    or computed values are left untouched.
 * 2. Text `color:` declarations that fail contrast against the effective
 *    background are lifted via adaptTextColorForDark. `border-color`,
 *    `-webkit-text-fill-color` and friends are not matched.
 */
export const adaptDeclarationBlockForDark = (block: string, dark: DarkPalette): string => {
  const blockBg = analyzeBlockBackground(block);
  let rewritten = block.replace(
    bgDeclRe(),
    (decl, prefix: string, value: string, important?: string) => {
      const v = value.trim();
      if (COMPLEX_BACKGROUND_RE.test(v)) return decl;
      const token = v.split(/\s+/)[0]!;
      if (!isLightCssColor(token)) return decl;
      return `${prefix}background-color: light-dark(${token}, var(--theme-bg-color))${important ?? ''}`;
    },
  );
  if (blockBg.kind === 'never') return rewritten;
  rewritten = rewritten.replace(
    colorDeclRe(),
    (decl, prefix: string, value: string, important?: string) => {
      const adapted = adaptTextColorForDark(value, dark, blockBg);
      return adapted ? `${prefix}color: ${adapted}${important ?? ''}` : decl;
    },
  );
  return rewritten;
};
