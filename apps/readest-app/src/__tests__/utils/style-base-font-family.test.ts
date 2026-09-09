import { describe, it, expect } from 'vitest';

import { getBaseFontFamily } from '@/utils/style';
import { ViewSettings } from '@/types/book';
import { DEFAULT_BOOK_FONT } from '@/services/constants';

/** Build a minimal ViewSettings carrying just the font fields under test. */
function makeFontSettings(overrides: Partial<ViewSettings> = {}): ViewSettings {
  return {
    ...DEFAULT_BOOK_FONT,
    ...overrides,
  } as ViewSettings;
}

describe('getBaseFontFamily', () => {
  it('returns the serif chain when defaultFont is "Serif"', () => {
    const vs = makeFontSettings({ defaultFont: 'Serif', serifFont: 'Times New Roman' });
    const family = getBaseFontFamily(vs);
    // The chosen serif typeface leads the chain and it ends with the generic.
    expect(family.trimStart().startsWith('"Times New Roman"')).toBe(true);
    expect(family.trimEnd().endsWith('serif')).toBe(true);
    expect(family).not.toContain('sans-serif"');
  });

  it('returns the sans-serif chain when defaultFont is "Sans-serif"', () => {
    const vs = makeFontSettings({ defaultFont: 'Sans-serif', sansSerifFont: 'Arial' });
    const family = getBaseFontFamily(vs);
    expect(family.trimStart().startsWith('"Arial"')).toBe(true);
    expect(family.trimEnd().endsWith('sans-serif')).toBe(true);
  });

  it('places a custom serif font at the head of the chain', () => {
    const vs = makeFontSettings({ defaultFont: 'Serif', serifFont: 'My Custom Font' });
    const family = getBaseFontFamily(vs);
    expect(family.trimStart().startsWith('"My Custom Font"')).toBe(true);
  });

  it('includes the CJK font in the resolved chain', () => {
    const vs = makeFontSettings({
      defaultFont: 'Serif',
      serifFont: 'Times New Roman',
      defaultCJKFont: 'KaiTi',
    });
    const family = getBaseFontFamily(vs);
    expect(family).toContain('"KaiTi"');
  });
});

describe('common reading fonts', () => {
  it('replaces the old default library with common system faces', () => {
    const family = getBaseFontFamily(makeFontSettings());
    expect(family).toMatch(/^"Times New Roman"/);
    expect(family).toContain('"Songti SC"');
    expect(family).not.toMatch(/Bitter|WenKai|MiSans|Huiwen/);
  });

  it('provides local aliases for Chinese calligraphic typefaces', () => {
    const family = getBaseFontFamily(makeFontSettings({ defaultCJKFont: 'KaiTi' }));
    expect(family).toContain('"KaiTi"');
    expect(family).toContain('"Kaiti SC"');
    expect(family).toContain('"AR PL UKai CN"');
  });
});
