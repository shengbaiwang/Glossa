import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_BOOK_FONT,
  DEFAULT_BOOK_LAYOUT,
  DEFAULT_BOOK_STYLE,
  DEFAULT_VIEW_CONFIG,
  DEFAULT_BOOK_LANGUAGE,
} from '@/services/constants';
import { ViewSettings } from '@/types/book';
import { mountAdditionalFonts } from '@/styles/fonts';
import { getStyles } from '@/utils/style';

const frames: HTMLIFrameElement[] = [];
afterEach(() => frames.splice(0).forEach((frame) => frame.remove()));

describe('reading font CSS in a real document', () => {
  it.each([
    ['en', 'Times New Roman', 'Arial'],
    ['zh-CN', 'SimSun', 'Microsoft YaHei'],
    ['zh-TW', 'MingLiU', 'Microsoft JhengHei'],
    ['ja', 'Yu Mincho', 'Yu Gothic'],
    ['ko', 'Batang', 'Malgun Gothic'],
    ['ar', 'Traditional Arabic', 'Tahoma'],
  ])('applies and updates fonts for %s without remote font styles', async (language, serif, sans) => {
    const frame = document.createElement('iframe');
    frames.push(frame);
    document.body.append(frame);
    const doc = frame.contentDocument!;
    doc.body.innerHTML = '<p>Reading 阅读 読書 독서 القراءة</p>';
    if (language === 'ar') doc.documentElement.dir = 'rtl';
    await mountAdditionalFonts(doc, language);
    const style = doc.createElement('style');
    const settings = {
      ...DEFAULT_BOOK_FONT,
      ...DEFAULT_BOOK_LAYOUT,
      ...DEFAULT_BOOK_STYLE,
      ...DEFAULT_VIEW_CONFIG,
      ...DEFAULT_BOOK_LANGUAGE,
      overrideFont: true,
    } as ViewSettings;
    style.textContent = getStyles(settings);
    doc.head.append(style);
    const text = doc.querySelector('p')!;
    expect(frame.contentWindow!.getComputedStyle(text).fontFamily).toContain(serif);
    style.textContent = getStyles({ ...settings, defaultFont: 'Sans-serif' });
    expect(frame.contentWindow!.getComputedStyle(text).fontFamily).toContain(sans);
    expect(doc.querySelectorAll('link')).toHaveLength(0);
    expect(style.textContent).not.toMatch(/fonts.googleapis|onlinewebfonts|storage.readest/);
    if (language === 'ar')
      expect(frame.contentWindow!.getComputedStyle(text).direction).toBe('rtl');
  });
  it('loads the bundled Kai font even when system Kai fonts are absent', async () => {
    const frame = document.createElement('iframe');
    frames.push(frame);
    document.body.append(frame);
    const doc = frame.contentDocument!;
    await mountAdditionalFonts(doc, 'zh-CN');
    const loaded = await doc.fonts.load('24px "Glossa Kai"', '阅读閱讀');
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.status).toBe('loaded');
  });
});
