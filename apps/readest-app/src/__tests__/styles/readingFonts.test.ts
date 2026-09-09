import { describe, expect, it } from 'vitest';
import {
  buildFontFamilyLists,
  getReadingFontFamily,
  resolveReadingFont,
} from '@/styles/readingFonts';

const families = (language: string, cjk = 'Auto') =>
  buildFontFamilyLists('Times New Roman', 'Arial', 'Courier New', cjk, language);

describe('regional reading fonts', () => {
  it('uses a valid generic font for the automatic option preview', () => {
    expect(getReadingFontFamily('Auto', 'serif')).toBe('serif');
  });
  it.each([
    ['zh-CN', 'SimSun', 'Microsoft YaHei'],
    ['zh-TW', 'MingLiU', 'Microsoft JhengHei'],
    ['zh-Hant-HK', 'MingLiU', 'Microsoft JhengHei'],
    ['ja-JP', 'Yu Mincho', 'Yu Gothic'],
    ['ko-KR', 'Batang', 'Malgun Gothic'],
  ])('uses the matching regional glyphs for %s', (lang, serif, sans) => {
    const result = families(lang);
    expect(result.serif).toContain(`"${serif}"`);
    expect(result.sansSerif).toContain(`"${sans}"`);
    if (!lang.startsWith('zh-CN')) expect(result.serif).not.toContain('"SimSun"');
    expect(result.serif).not.toContain('"Auto"');
  });

  it('uses distinct serif and sans-serif CJK defaults', () => {
    expect(families('zh-CN').sansSerif).not.toContain('"SimSun"');
  });

  it('prioritizes common Arabic faces over Latin fonts with Arabic glyphs', () => {
    expect(families('ar-SA').serif).toMatch(/^"Traditional Arabic", "Geeza Pro"/);
    expect(families('ar-SA').sansSerif).toMatch(/^"Tahoma", "Geeza Pro"/);
  });

  it('keeps an explicitly chosen CJK face', () => {
    expect(families('ja', 'KaiTi').serif).toContain('"Kaiti SC"');
  });

  it('resolves old built-in selections without keeping network font dependencies', () => {
    const result = buildFontFamilyLists(
      'Bitter',
      'Roboto',
      'Fira Code',
      'LXGW WenKai GB Screen',
      'ja',
    );
    expect(result.serif).toMatch(/^"Times New Roman"/);
    expect(result.serif).toContain('"Yu Mincho"');
    expect(result.sansSerif).toMatch(/^"Arial"/);
    expect(result.monospace).toMatch(/^"Courier New"/);
    expect(JSON.stringify(result)).not.toMatch(/Bitter|Roboto|Fira Code|WenKai/);
  });

  it('replaces arbitrary previous selections with common fonts in every reading family', () => {
    expect(resolveReadingFont('Bitter')).toBe('Times New Roman');
    const result = buildFontFamilyLists(
      '100-SS Xian Song Ti',
      '波本威士忌',
      '三极花朝体',
      '寒蝉锦书宋Compact',
      'ja',
    );
    expect(result.serif).toMatch(/^"Times New Roman"/);
    expect(result.sansSerif).toMatch(/^"Arial"/);
    expect(result.monospace).toMatch(/^"Courier New"/);
    expect(result.serif).toContain('"Yu Mincho"');
    expect(JSON.stringify(result)).not.toMatch(/100-SS|波本|三极|寒蝉/);
  });
  it('keeps other installed and imported fonts available for extension', () => {
    expect(resolveReadingFont('My System Font')).toBe('My System Font');
    const result = buildFontFamilyLists('My Reading Font', 'My Sans', 'My Mono', 'Auto', 'ja');
    expect(result.serif).toMatch(/^"My Reading Font"/);
    expect(result.sansSerif).toMatch(/^"My Sans"/);
    expect(result.monospace).toMatch(/^"My Mono"/);
  });

  it('preserves an imported font that shares a former built-in name', () => {
    const result = buildFontFamilyLists('Bitter', 'Arial', 'Courier New', 'Auto', 'ja', ['Bitter']);
    expect(result.serif).toMatch(/^"Bitter"/);
  });
});
