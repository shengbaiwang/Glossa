import { describe, expect, it } from 'vitest';
import {
  adaptDeclarationBlockForDark,
  adaptTextColorForDark,
  getThemeDarkPalette,
} from '@/utils/adaptiveTextColor';

const DARK = { bg: '#20211f', fg: '#edeee8' };

describe('getThemeDarkPalette', () => {
  it('returns the dark palette of the current theme regardless of theme mode', () => {
    // jsdom localStorage has no themeMode set here; the palette must still be
    // the dark one so adaptation decisions are mode-independent.
    const palette = getThemeDarkPalette();
    expect(palette.bg).toMatch(/^#[0-9a-f]{6}$/i);
    expect(palette.fg).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe('adaptTextColorForDark', () => {
  it('lifts black and dark grays toward the theme foreground with ordered strength', () => {
    const black = adaptTextColorForDark('#000', DARK);
    const darkGray = adaptTextColorForDark('#444', DARK);
    const midGray = adaptTextColorForDark('#777', DARK);
    expect(black).toBe(
      'light-dark(#000, color-mix(in srgb, var(--theme-fg-color) 100%, var(--theme-bg-color)))',
    );
    expect(darkGray).toMatch(
      /^light-dark\(#444, color-mix\(in srgb, var\(--theme-fg-color\) (\d+)%, var\(--theme-bg-color\)\)\)$/,
    );
    expect(midGray).toMatch(
      /^light-dark\(#777, color-mix\(in srgb, var\(--theme-fg-color\) (\d+)%, var\(--theme-bg-color\)\)\)$/,
    );
    const ratioOf = (v: string | null) => Number(/(\d+)%/.exec(v!)![1]);
    // 注释稍弱于正文：结果明度随原始亮度递减，但最弱仍锚定约七成前景
    expect(ratioOf(black)).toBe(100);
    expect(ratioOf(darkGray)).toBeLessThan(100);
    expect(ratioOf(darkGray)).toBeGreaterThan(ratioOf(midGray));
    expect(ratioOf(midGray)).toBeGreaterThanOrEqual(70);
  });

  it('lifts dark chromatic colors with hue-preserving soft white mixes', () => {
    expect(adaptTextColorForDark('#000080', DARK)).toBe(
      'light-dark(#000080, color-mix(in oklch, #000080 45%, white))',
    );
    expect(adaptTextColorForDark('#006400', DARK)).toBe(
      'light-dark(#006400, color-mix(in oklch, #006400 45%, white))',
    );
    expect(adaptTextColorForDark('maroon', DARK)).toBe(
      'light-dark(maroon, color-mix(in oklch, maroon 45%, white))',
    );
  });

  it('parses rgb() and hsl() declarations', () => {
    expect(adaptTextColorForDark('rgb(0, 0, 128)', DARK)).toContain('light-dark(rgb(0, 0, 128),');
    expect(adaptTextColorForDark('hsl(240, 100%, 13%)', DARK)).toContain(
      'light-dark(hsl(240, 100%, 13%),',
    );
  });

  it('keeps colors that already read well on the dark page', () => {
    expect(adaptTextColorForDark('#fc0', DARK)).toBeNull();
    expect(adaptTextColorForDark('#7fff00', DARK)).toBeNull();
    expect(adaptTextColorForDark('#edeee8', DARK)).toBeNull();
    expect(adaptTextColorForDark('white', DARK)).toBeNull();
  });

  it('keeps text that is readable on its own kept dark background', () => {
    expect(adaptTextColorForDark('#fff', DARK, { kind: 'color', color: '#000' })).toBeNull();
  });

  it('lifts failing text against its own kept dark background', () => {
    const adapted = adaptTextColorForDark('#000', DARK, { kind: 'color', color: '#123' });
    expect(adapted).toContain('light-dark(#000,');
  });

  it('never lifts text on kept mid-tone, translucent, or unknown backgrounds', () => {
    expect(adaptTextColorForDark('#333', DARK, { kind: 'never' })).toBeNull();
  });

  it('skips keywords, adaptive values, transparent and invalid colors', () => {
    expect(adaptTextColorForDark('inherit', DARK)).toBeNull();
    expect(adaptTextColorForDark('currentColor', DARK)).toBeNull();
    expect(adaptTextColorForDark('transparent', DARK)).toBeNull();
    expect(adaptTextColorForDark('var(--theme-fg-color)', DARK)).toBeNull();
    expect(adaptTextColorForDark('light-dark(#000, #fff)', DARK)).toBeNull();
    expect(adaptTextColorForDark('color-mix(in srgb, #000 40%, white)', DARK)).toBeNull();
    expect(adaptTextColorForDark('rgba(0,0,0,0)', DARK)).toBeNull();
    expect(adaptTextColorForDark('not-a-color', DARK)).toBeNull();
  });

  it('folds achromatic alpha into the mix ratio', () => {
    const adapted = adaptTextColorForDark('rgba(0, 0, 0, 0.5)', DARK);
    expect(adapted).toContain('var(--theme-fg-color) 50%');
  });
});

describe('adaptDeclarationBlockForDark', () => {
  it('wraps pure light backgrounds and lifts failing text in the same block', () => {
    const result = adaptDeclarationBlockForDark(
      '{ background-color: #ffffff; color: #333; }',
      DARK,
    );
    expect(result).toContain('background-color: light-dark(#ffffff, var(--theme-bg-color))');
    expect(result).toContain('color: light-dark(#333, color-mix(in srgb, var(--theme-fg-color)');
  });

  it('lifts text on blocks without background against the theme dark page', () => {
    const result = adaptDeclarationBlockForDark('{ color: navy; }', DARK);
    expect(result).toBe('{ color: light-dark(navy, color-mix(in oklch, navy 45%, white)); }');
  });

  it('keeps text and background untouched on kept mid-tone backgrounds', () => {
    const block = '{ background-color: #bbb; color: #222; }';
    expect(adaptDeclarationBlockForDark(block, DARK)).toBe(block);
  });

  it('keeps text untouched on image or gradient backgrounds', () => {
    const block = '{ background: #fff url(paper.png); color: #555; }';
    expect(adaptDeclarationBlockForDark(block, DARK)).toBe(block);
  });

  it('preserves !important on rewritten declarations', () => {
    const result = adaptDeclarationBlockForDark('{ color: #333 !important; }', DARK);
    expect(result).toContain(
      'color: light-dark(#333, color-mix(in srgb, var(--theme-fg-color) 94%, var(--theme-bg-color))) !important',
    );
  });

  it('leaves border-color and other properties untouched', () => {
    const result = adaptDeclarationBlockForDark(
      '{ border: 1px solid #333; color: #000080; }',
      DARK,
    );
    expect(result).toContain('border: 1px solid #333');
    expect(result).toContain('color: light-dark(#000080,');
  });

  it('handles inline-style declaration lists without braces and trailing semicolons', () => {
    expect(adaptDeclarationBlockForDark('color: #000080', DARK)).toBe(
      'color: light-dark(#000080, color-mix(in oklch, #000080 45%, white))',
    );
    expect(adaptDeclarationBlockForDark('color: navy; font-weight: bold', DARK)).toBe(
      'color: light-dark(navy, color-mix(in oklch, navy 45%, white)); font-weight: bold',
    );
  });

  it('is idempotent across repeated transforms', () => {
    const block = '{ background-color: #fff; color: #333; }';
    const once = adaptDeclarationBlockForDark(block, DARK);
    expect(adaptDeclarationBlockForDark(once, DARK)).toBe(once);
  });
});
