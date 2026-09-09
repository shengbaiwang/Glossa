import { describe, expect, it } from 'vitest';
import { getFontPreviewSample } from '@/utils/fontPreview';

describe('font preview language', () => {
  it('preserves the requested Chinese verse and uses the document script', () => {
    expect(getFontPreviewSample('zh-CN')).toEqual({
      text: '微雨从东来，好风与之俱',
      lang: 'zh-Hans',
      dir: 'ltr',
    });
    for (const language of ['zh-TW', 'zh-Hant', 'zh_HK', 'ZH-mo']) {
      expect(getFontPreviewSample(language)).toEqual({
        text: '微雨從東來，好風與之俱',
        lang: 'zh-Hant',
        dir: 'ltr',
      });
    }
  });

  it('uses the exact Latin sample for Western languages and unknown languages', () => {
    for (const language of ['en', 'fr-FR', 'de', 'es', 'sr-Latn', 'unknown', undefined]) {
      expect(getFontPreviewSample(language)).toEqual({
        text: 'Sunt lacrimae rerum et mentem mortalia tangunt.',
        lang: 'la',
        dir: 'ltr',
      });
    }
  });

  it('offers poetic text in supported non-Latin scripts with correct direction', () => {
    const cases = [
      ['ja-JP', 'ja', 'ltr', /[\p{Script=Hiragana}]/u],
      ['ko-KR', 'ko', 'ltr', /[\p{Script=Hangul}]/u],
      ['ar-SA', 'ar', 'rtl', /[\p{Script=Arabic}]/u],
      ['fa', 'fa', 'rtl', /[\p{Script=Arabic}]/u],
      ['he', 'he', 'rtl', /[\p{Script=Hebrew}]/u],
      ['ru', 'ru', 'ltr', /[\p{Script=Cyrillic}]/u],
      ['uk', 'uk', 'ltr', /[\p{Script=Cyrillic}]/u],
      ['el', 'el', 'ltr', /[\p{Script=Greek}]/u],
      ['hi', 'hi', 'ltr', /[\p{Script=Devanagari}]/u],
      ['bn', 'bn', 'ltr', /[\p{Script=Bengali}]/u],
      ['th', 'th', 'ltr', /[\p{Script=Thai}]/u],
      ['ta-IN', 'ta', 'ltr', /[\p{Script=Tamil}]/u],
      ['si-LK', 'si', 'ltr', /[\p{Script=Sinhala}]/u],
      ['bo-CN', 'bo', 'ltr', /[\p{Script=Tibetan}]/u],
    ] as const;
    for (const [language, lang, dir, script] of cases) {
      const sample = getFontPreviewSample(language);
      expect(sample).toMatchObject({ lang, dir });
      expect(sample.text).toMatch(script);
    }
  });
});
