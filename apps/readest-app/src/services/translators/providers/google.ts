import { stubTranslation as _ } from '@/utils/misc';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { isTauriAppPlatform } from '@/services/environment';
import { normalizeToShortLang } from '@/utils/lang';
import { TranslationProvider } from '../types';

export const googleProvider: TranslationProvider = {
  name: 'google',
  label: _('Google Translate'),
  preservesMarkup: true,
  translate: async (
    text: string[],
    sourceLang: string,
    targetLang: string,
    _token?: string | null,
    _cache?: boolean,
    signal?: AbortSignal,
  ): Promise<string[]> => {
    if (!text.length) return [];

    const results: string[] = [];

    const translationPromises = text.map(async (line, index) => {
      if (!line?.trim().length) {
        results[index] = line;
        return;
      }

      const url = new URL('https://translate.googleapis.com/translate_a/single');
      url.searchParams.append('client', 'gtx');
      url.searchParams.append('dt', 't');
      url.searchParams.append('sl', normalizeToShortLang(sourceLang).toLowerCase() || 'auto');
      const normalizedTarget = normalizeToShortLang(targetLang).toLowerCase();
      url.searchParams.append(
        'tl',
        normalizedTarget === 'zh-hant'
          ? 'zh-TW'
          : normalizedTarget === 'zh-hans'
            ? 'zh-CN'
            : normalizedTarget,
      );
      url.searchParams.append('q', line);

      const fetch = isTauriAppPlatform() ? tauriFetch : window.fetch;
      const response = await fetch(url.toString(), { signal });

      if (!response.ok) {
        throw new Error(`Translation failed with status ${response.status}`);
      }

      const data: unknown = await response.json();
      if (Array.isArray(data) && Array.isArray(data[0])) {
        const translatedText = data[0]
          .filter(
            (segment: unknown): segment is [string] =>
              Array.isArray(segment) && typeof segment[0] === 'string',
          )
          .map((segment) => segment[0])
          .join('');

        if (!translatedText) throw new Error('Empty translation');
        results[index] = translatedText;
      } else {
        throw new Error('Invalid translation');
      }
    });

    await Promise.all(translationPromises);

    return results;
  },
};
