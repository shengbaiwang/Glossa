import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import ReadingSpeechPlayer from '@/app/reader/components/tts/ReadingSpeechPlayer';
import DictionaryPopup from '@/app/reader/components/annotator/DictionaryPopup';
import SelectionTranslation from '@/app/reader/components/annotator/SelectionTranslation';
import { eventDispatcher } from '@/utils/event';
import '@/styles/globals.css';
import '@/styles/glossa.css';
import '@/styles/glossa-reader.css';

const f = vi.hoisted(() => ({
  paused: vi.fn(),
  stopped: vi.fn(),
  translate: vi.fn(async () => ['一段简洁的译文。']),
}));
vi.mock('@/hooks/useTranslation', async () => {
  const translations = await fetch('/locales/zh-CN/translation.json').then((response) =>
    response.json(),
  );
  return { useTranslation: () => (key: string) => translations[key] || key };
});
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {}, appService: {} }) }));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: Object.assign(() => ({}), {
    getState: () => ({ getView: vi.fn(), getViewSettings: () => ({ ttsRate: 1, ttsVoice: '' }) }),
  }),
}));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: {
    getState: () => ({ getBookData: () => ({ book: { primaryLanguage: 'zh' } }) }),
  },
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: (
    selector: (s: { settings: { globalReadSettings: { translateTargetLang: string } } }) => unknown,
  ) => selector({ settings: { globalReadSettings: { translateTargetLang: 'ZH' } } }),
}));
vi.mock('@/helpers/settings', () => ({ saveViewSettings: vi.fn() }));
vi.mock('@/services/tts/wordPronouncer', () => ({
  cancelWordPronounce: vi.fn(),
  pronounceWord: vi.fn(),
}));
vi.mock('@/services/translators/providers/google', () => ({
  googleProvider: { translate: f.translate },
}));
vi.mock('@/services/dictionaries/registry', () => ({
  getEnabledProviders: () => [
    {
      id: 'local',
      kind: 'builtin',
      label: '本机词典',
      lookup: async (_word: string, ctx: { container: HTMLElement }) => {
        ctx.container.textContent = 'gloss：注解，释义。';
        return { ok: true };
      },
    },
  ],
}));
vi.mock('@/services/tts/createReadingSpeech', () => ({
  createReadingSpeechClient: async () => ({
    initialized: true,
    init: async () => true,
    stop: f.stopped,
    shutdown: f.stopped,
    setPrimaryLang: vi.fn(),
    setRate: vi.fn(),
    setVoice: vi.fn(),
    getAllVoices: async () => [{ id: 'zh', name: '中文 · 系统声音', lang: 'zh' }],
    pause: f.paused,
    resume: vi.fn(),
    speak: async function* (_ssml: string, signal: AbortSignal) {
      yield { code: 'boundary', mark: 'selection' };
      await new Promise<void>((resolve) =>
        signal.addEventListener('abort', () => resolve(), { once: true }),
      );
    },
  }),
}));
afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('data-eink');
  document.documentElement.removeAttribute('dir');
});
it('keeps restored tools compact and usable in Chinese, dark, narrow, RTL and e-ink layouts', async () => {
  document.documentElement.setAttribute('data-theme', 'default-light');
  render(
    <>
      <ReadingSpeechPlayer />
      <div
        style={{
          width: 320,
          padding: 16,
          background: 'var(--glossa-surface)',
          color: 'var(--glossa-ink)',
        }}
      >
        <SelectionTranslation text='selected text' onClose={vi.fn()} />
      </div>
      <DictionaryPopup
        word='gloss'
        position={{ dir: 'down', point: { x: 24, y: 180 } }}
        trianglePosition={{ dir: 'down', point: { x: 40, y: 180 } }}
        popupWidth={320}
        popupHeight={280}
        onDismiss={vi.fn()}
      />
    </>,
  );
  eventDispatcher.dispatch('tts-start', { bookKey: 'book', text: '只朗读选中的这一句话。' });
  await screen.findByText('一段简洁的译文。');
  expect((screen.getByLabelText('目标语言') as HTMLSelectElement).value).toBe('zh-CN');
  await screen.findByText('gloss：注解，释义。');
  await waitFor(() =>
    expect(screen.getByLabelText('声音').querySelectorAll('option')).toHaveLength(2),
  );
  fireEvent.click(screen.getByLabelText('暂停'));
  expect(f.paused).toHaveBeenCalled();
  await page.screenshot({ path: '../../../../../.glossa-dev/qa/reading-tools-light.png' });
  await page.viewport(375, 720);
  for (const [theme, eink, dir] of [
    ['default-light', 'false', 'ltr'],
    ['default-dark', 'false', 'ltr'],
    ['default-light', 'true', 'rtl'],
  ]) {
    document.documentElement.setAttribute('data-theme', theme!);
    document.documentElement.setAttribute('data-eink', eink!);
    document.documentElement.dir = dir!;
    const player = document.querySelector('.glossa-speech-player')!;
    expect(player.getBoundingClientRect().left).toBeGreaterThanOrEqual(0);
    expect(player.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth);
    expect(player.scrollWidth).toBeLessThanOrEqual(player.clientWidth + 1);
    await page.screenshot({
      path: `../../../../../.glossa-dev/qa/reading-tools-${theme}-${dir}.png`,
    });
  }
});
