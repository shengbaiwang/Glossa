import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import FontPanel from '@/components/settings/FontPanel';
import { ChevronLeft, PanelLeft, Type, X } from '@/components/GlossaIcons';
import '@/styles/globals.css';
import '@/styles/glossa.css';

const zh: Record<string, string> = await (await fetch('/locales/zh-CN/translation.json')).json();
const t = (key: string) => zh[key] || key;
const fixture = vi.hoisted(() => ({
  settings: {
    serifFont: 'Times New Roman',
    sansSerifFont: 'Arial',
    monospaceFont: 'Courier New',
    defaultFont: 'Serif',
    defaultCJKFont: 'SimSun',
    defaultFontSize: 18,
    minimumFontSize: 8,
    fontWeight: 400,
    overrideFont: false,
    isGlobal: false,
  },
  view: { language: { canonical: 'zh-CN', isCJK: true, direction: 'ltr' } },
  importedFonts: ['Synthetic Imported Reading Font With A Long Family Name'],
  fonts: [],
  envConfig: {},
  appService: { isAndroidApp: false },
  save: vi.fn(),
  setFontPanelView: vi.fn(),
}));

// Replace every store and native/persistence boundary. This fixture never opens
// a book, reads user preferences/fonts, or writes to the local reading library.
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: fixture.envConfig, appService: fixture.appService }),
}));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => t }));
vi.mock('@/utils/bridge', () => ({
  getSysFontsList: async () => ({ fonts: { 'Synthetic System Font': 'Synthetic System Font' } }),
}));
vi.mock('@/services/environment', () => ({ isTauriAppPlatform: () => true }));
vi.mock('@/utils/misc', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  getOSPlatform: () => 'macos',
  getLocale: () => 'zh-CN',
  getUserLang: () => 'zh-CN',
  isCJKEnv: () => true,
  isCaselessUILang: () => true,
}));
vi.mock('@/hooks/useResetSettings', () => ({ useResetViewSettings: () => vi.fn() }));
vi.mock('@/helpers/settings', () => ({ saveViewSettings: fixture.save }));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    getView: () => fixture.view,
    getViewSettings: () => fixture.settings,
  }),
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: { globalViewSettings: fixture.settings, i18nLang: 'zh-CN' },
    fontPanelView: 'main-fonts',
    setFontPanelView: fixture.setFontPanelView,
  }),
}));
vi.mock('@/store/customFontStore', () => ({
  useCustomFontStore: () => ({
    fonts: fixture.fonts,
    getFontFamilies: () => fixture.importedFonts,
  }),
}));
vi.mock('@/store/deviceStore', () => ({
  useDeviceControlStore: () => ({
    acquireBackKeyInterception: vi.fn(),
    releaseBackKeyInterception: vi.fn(),
  }),
}));
vi.mock('@/components/settings/CustomFonts', () => ({ default: () => null }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  for (const attribute of ['data-theme', 'data-eink', 'lang', 'dir']) {
    document.documentElement.removeAttribute(attribute);
  }
});

it('previews and selects fonts with real Glossa styles across desktop, narrow, dark and RTL/e-ink layouts', async () => {
  await page.viewport(820, 1000);
  document.documentElement.setAttribute('data-theme', 'default-light');
  document.documentElement.lang = 'zh-CN';
  const onSettingsKeyDown = vi.fn((event: Event) => {
    if (event instanceof KeyboardEvent && event.key === 'Escape') {
      settingsHost.setAttribute('data-settings-closed', 'true');
    }
    event.stopPropagation();
  });
  const view = render(
    <div className='glossa-settings'>
      <main
        className='modal-box settings-content bg-base-200'
        style={{
          position: 'relative',
          width: 560,
          maxWidth: 'calc(100vw - 32px)',
          maxHeight: 'none',
          margin: '24px auto',
          padding: 24,
          transform: 'none',
        }}
      >
        <FontPanel bookKey='synthetic-font-preview' onRegisterReset={vi.fn()} />
      </main>
    </div>,
  );
  const settingsHost = view.container.firstElementChild!;
  // The real Dialog intercepts native bubbling key events before React's root
  // delegation; picker/input capture handlers must take precedence over it.
  settingsHost.addEventListener('keydown', onSettingsKeyDown);
  const sheet = view.container.querySelector('main')!;
  const expectSaved = async (key: string, value: string | number | boolean) => {
    await waitFor(() =>
      expect(fixture.save).toHaveBeenCalledWith(
        fixture.envConfig,
        'synthetic-font-preview',
        key,
        value,
      ),
    );
  };
  const assertNoOverflow = () => {
    expect(sheet.scrollWidth).toBeLessThanOrEqual(sheet.clientWidth);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
    const bounds = sheet.getBoundingClientRect();
    for (const control of sheet.querySelectorAll('input, select, button')) {
      const rect = control.getBoundingClientRect();
      expect(rect.left).toBeGreaterThanOrEqual(bounds.left - 1);
      expect(rect.right).toBeLessThanOrEqual(bounds.right + 1);
    }
  };

  expect(screen.getByRole('button', { name: t('Book Fonts') }).getAttribute('aria-pressed')).toBe(
    'true',
  );
  fireEvent.click(screen.getByRole('button', { name: t('My Fonts') }));
  await expectSaved('overrideFont', true);
  const chinese = screen.getByText('微雨从东来，好风与之俱');
  const western = screen.getByText('Sunt lacrimae rerum et mentem mortalia tangunt.');
  expect(chinese).toBeTruthy();
  expect(western).toBeTruthy();
  expect(screen.queryByText(t('Minimum Font Size'))).toBeNull();
  assertNoOverflow();
  await document.fonts.ready;
  await page.screenshot({ path: '../../../../../../.glossa-dev/qa/font-settings-light.png' });

  const cjkTrigger = screen.getByRole('button', {
    name: `${t('Chinese Font')}: ${t('SimSun')}`,
  });
  fireEvent.click(cjkTrigger);
  const search = screen.getByRole('searchbox', { name: t('Search Fonts') });
  expect(document.activeElement).toBe(search);
  assertNoOverflow();
  await page.screenshot({ path: '../../../../../../.glossa-dev/qa/font-settings-picker.png' });
  fireEvent.change(search, { target: { value: 'KaiTi' } });
  fireEvent.click(screen.getByRole('button', { name: t('KaiTi') }));
  await waitFor(() => expect(getComputedStyle(chinese).fontFamily).toContain('KaiTi'));
  await expectSaved('defaultCJKFont', 'KaiTi');
  expect(screen.queryByRole('searchbox')).toBeNull();

  const westernTrigger = screen.getByRole('button', {
    name: `${t('Western Font')}: ${t('Times New Roman')}`,
  });
  fireEvent.click(westernTrigger);
  fireEvent.click(screen.getByRole('button', { name: t('Georgia') }));
  await waitFor(() => expect(getComputedStyle(western).fontFamily).toContain('Georgia'));
  await expectSaved('serifFont', 'Georgia');

  const sizeInput = screen.getByLabelText(t('Font Size'));
  sizeInput.focus();
  fireEvent.change(sizeInput, { target: { value: '22' } });
  fireEvent.keyDown(sizeInput, { key: 'Enter' });
  await expectSaved('defaultFontSize', 22);
  fireEvent.click(screen.getByRole('button', { name: t('Medium') }));
  await expectSaved('fontWeight', 500);

  const updatedTrigger = screen.getByRole('button', {
    name: `${t('Chinese Font')}: ${t('KaiTi')}`,
  });
  fireEvent.click(updatedTrigger);
  fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'ArrowDown' });
  expect(document.activeElement).toBe(screen.getByRole('button', { name: t('KaiTi') }));
  onSettingsKeyDown.mockClear();
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  expect(onSettingsKeyDown).not.toHaveBeenCalled();
  expect(settingsHost.hasAttribute('data-settings-closed')).toBe(false);
  expect(screen.queryByRole('searchbox')).toBeNull();
  expect(document.activeElement).toBe(updatedTrigger);
  expect(screen.getByRole('button', { name: t('My Fonts') })).toBeTruthy();

  document.documentElement.setAttribute('data-theme', 'default-dark');
  await waitFor(() => {
    const selected = screen.getByRole('button', { name: t('Medium') });
    expect(getComputedStyle(selected).backgroundColor).toBe(
      getComputedStyle(screen.getByRole('region', { name: t('Font Preview') })).backgroundColor,
    );
  });
  assertNoOverflow();
  await page.screenshot({ path: '../../../../../../.glossa-dev/qa/font-settings-dark.png' });
  document.documentElement.setAttribute('data-theme', 'default-light');
  await page.viewport(390, 844);
  await waitFor(() => {
    const selected = screen.getByRole('button', { name: t('Medium') });
    expect(getComputedStyle(selected).backgroundColor).toBe(
      getComputedStyle(screen.getByRole('region', { name: t('Font Preview') })).backgroundColor,
    );
  });
  assertNoOverflow();
  if (matchMedia('(pointer: coarse)').matches) {
    for (const control of sheet.querySelectorAll(
      '.glossa-font-segments button, .glossa-font-stepper button',
    )) {
      const bounds = control.getBoundingClientRect();
      expect(bounds.width).toBeGreaterThanOrEqual(44);
      expect(bounds.height).toBeGreaterThanOrEqual(44);
    }
  }
  await page.screenshot({ path: '../../../../../../.glossa-dev/qa/font-settings-narrow.png' });
  fireEvent.click(screen.getByRole('button', { name: `${t('Western Font')}: Georgia` }));
  assertNoOverflow();
  await page.screenshot({
    path: '../../../../../../.glossa-dev/qa/font-settings-narrow-picker.png',
  });
  fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' });
  fireEvent.click(screen.getByRole('button', { name: t('More') }));
  expect(screen.getByText(t('Minimum Font Size'))).toBeTruthy();
  assertNoOverflow();

  document.documentElement.dir = 'rtl';
  document.documentElement.setAttribute('data-eink', 'true');
  assertNoOverflow();
  for (const selected of sheet.querySelectorAll('.glossa-font-segments [aria-pressed="true"]')) {
    const style = getComputedStyle(selected);
    expect(style.color).not.toBe(style.backgroundColor);
  }
  await page.screenshot({ path: '../../../../../../.glossa-dev/qa/font-settings-rtl-eink.png' });
}, 30_000);

function ReadingContextFixture() {
  const [open, setOpen] = useState(false);
  return (
    <div className='bg-base-100 text-base-content min-h-screen'>
      <header className='border-base-content/10 flex h-14 items-center gap-3 border-b px-6'>
        <ChevronLeft size={20} />
        <PanelLeft size={20} />
        <span className='ms-4 text-sm'>微雨与好风</span>
        <button
          type='button'
          className='glossa-button ms-auto'
          onClick={() => setOpen(true)}
          aria-label='打开字体设置'
        >
          <Type size={20} />
          字体
        </button>
      </header>
      <article
        aria-label='阅读正文'
        style={{
          width: 620,
          marginInlineStart: 144,
          paddingBlock: 100,
          fontFamily: 'SimSun, Songti SC, serif',
          fontSize: 22,
          lineHeight: 2.1,
        }}
      >
        <p className='text-base-content/50 mb-5 font-sans text-xs tracking-widest'>第一章</p>
        <h1 className='mb-9 text-3xl'>微雨与好风</h1>
        {/* Original text written only for this layout fixture; no user book is opened. */}
        <p className='mb-6'>
          窗外的雨很轻。树叶承住细小的水珠，风一过，便把它们送回土地。屋里的人翻开书，沿着一行字慢慢读下去。
        </p>
        <p className='mb-6'>
          阅读有时像走一条安静的路。我们不必急着抵达结尾，只需看清眼前的句子，再把它和已经走过的路连在一起。
        </p>
        <p className='mb-6'>
          留白让目光歇息，恰当的间距让思想继续。一个字的形状、一句话的停顿，都可以让理解来得更自然。
        </p>
        <p>雨还没有停，书页却已翻过。方才读到的意思，像窗边渐渐明亮的天色，留在心里。</p>
      </article>
      {open && (
        <div className='glossa-settings glossa-reader-font-settings modal-open fixed inset-0 z-50 flex items-center justify-center'>
          <div className='dialog-overlay absolute inset-0 z-10 bg-black/50 sm:!bg-black/20' />
          <section
            aria-label='字体设置'
            className='modal-box settings-content bg-base-200 absolute z-20 flex h-full max-h-full w-full max-w-full flex-col overflow-hidden p-0 sm:min-w-[520px] sm:rounded-2xl'
          >
            <header className='flex h-12 shrink-0 items-center justify-between px-5'>
              <span className='flex items-center gap-2 text-sm'>
                <Type size={18} />
                字体
              </span>
              <button
                type='button'
                className='glossa-icon-button'
                onClick={() => setOpen(false)}
                aria-label='关闭字体设置'
              >
                <X size={16} />
              </button>
            </header>
            <div className='min-h-0 flex-grow overflow-y-auto px-5 pb-4'>
              <FontPanel bookKey='synthetic-font-preview' onRegisterReset={vi.fn()} />
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

it('keeps the reader width stable and opens a transparent desktop side sheet at the logical trailing edge', async () => {
  await page.viewport(1440, 900);
  document.documentElement.setAttribute('data-theme', 'default-light');
  document.documentElement.lang = 'zh-CN';
  const view = render(<ReadingContextFixture />);
  const reader = screen.getByRole('article', { name: '阅读正文' });
  const initialReader = reader.getBoundingClientRect();
  fireEvent.click(screen.getByRole('button', { name: '打开字体设置' }));
  const sheet = screen.getByRole('region', { name: '字体设置' });
  await waitFor(() => expect(sheet.getBoundingClientRect().width).toBe(440));
  const bounds = sheet.getBoundingClientRect();
  expect(bounds.width).toBe(440);
  expect(bounds.right).toBe(1420);
  expect(bounds.top).toBe(64);
  expect(getComputedStyle(view.container.querySelector('.dialog-overlay')!).backgroundColor).toBe(
    'rgba(0, 0, 0, 0)',
  );
  expect(reader.getBoundingClientRect().width).toBe(initialReader.width);
  expect(reader.getBoundingClientRect().left).toBe(initialReader.left);
  expect(sheet.scrollWidth).toBeLessThanOrEqual(sheet.clientWidth);

  fireEvent.click(screen.getByRole('button', { name: t('My Fonts') }));
  fireEvent.click(screen.getByRole('button', { name: `${t('Chinese Font')}: ${t('SimSun')}` }));
  fireEvent.click(screen.getByRole('button', { name: t('KaiTi') }));
  await document.fonts.ready;
  await page.screenshot({ path: '../../../../../../.glossa-dev/qa/font-settings-reading.png' });
  fireEvent.click(screen.getByRole('button', { name: `${t('Chinese Font')}: ${t('KaiTi')}` }));
  expect(sheet.scrollWidth).toBeLessThanOrEqual(sheet.clientWidth);
  await page.screenshot({
    path: '../../../../../../.glossa-dev/qa/font-settings-reading-picker.png',
  });
  fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' });
  document.documentElement.dir = 'rtl';
  expect(sheet.getBoundingClientRect().left).toBe(20);
  expect(sheet.getBoundingClientRect().width).toBe(440);
  expect(reader.getBoundingClientRect().width).toBe(initialReader.width);
  fireEvent.click(screen.getByRole('button', { name: '关闭字体设置' }));
  expect(screen.queryByRole('region', { name: '字体设置' })).toBeNull();
  expect(reader.getBoundingClientRect().width).toBe(initialReader.width);
}, 30_000);
