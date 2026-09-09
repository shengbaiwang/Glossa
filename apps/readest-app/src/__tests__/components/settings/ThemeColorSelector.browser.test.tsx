import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import ThemeColorSelector from '@/components/settings/theme/ThemeColorSelector';
import ThemeEditor from '@/components/settings/theme/ThemeEditor';
import { themes, type Theme } from '@/styles/themes';
import '@/styles/globals.css';
import '@/styles/glossa.css';

const zh: Record<string, string> = await (await fetch('/locales/zh-CN/translation.json')).json();
const t = (key: string) => zh[key] || key;
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => t }));
vi.mock('@/utils/misc', () => ({ isCaselessUILang: () => true }));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({ settings: { globalReadSettings: { customThemes: [] } } }),
}));

// This fixture has no app stores, books, user preferences or persistence boundaries.
const custom: Theme = {
  ...themes[0]!,
  name: 'synthetic-paper',
  label: '窗边的书页与安静的午后',
  isCustomizable: true,
};
const select = vi.fn();
const edit = vi.fn();
const create = vi.fn();

function ThemeFixture({
  dark = false,
  initial = 'default',
  width = 560,
  includeCustom = true,
}: {
  dark?: boolean;
  initial?: string;
  width?: number;
  includeCustom?: boolean;
}) {
  const [selected, setSelected] = useState(initial);
  return (
    <div className='glossa-settings'>
      <main
        aria-label='阅读配色设置'
        className='modal-box settings-content bg-base-200 text-base-content'
        style={{
          position: 'relative',
          width,
          maxWidth: 'calc(100vw - 32px)',
          maxHeight: 'none',
          margin: '24px auto',
          padding: 20,
          transform: 'none',
        }}
      >
        <ThemeColorSelector
          themes={includeCustom ? [...themes, custom] : themes}
          themeColor={selected}
          isDarkMode={dark}
          onThemeColorChange={(name) => {
            select(name);
            setSelected(name);
          }}
          onEditTheme={edit}
          onCreateTheme={create}
          data-setting-id='settings.color.themeColor'
        />
      </main>
    </div>
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  for (const attribute of ['data-theme', 'data-eink', 'lang', 'dir']) {
    document.documentElement.removeAttribute(attribute);
  }
});

function assertNoOverflow(sheet: HTMLElement) {
  expect(sheet.scrollWidth).toBeLessThanOrEqual(sheet.clientWidth);
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  const sheetBounds = sheet.getBoundingClientRect();
  for (const control of sheet.querySelectorAll<HTMLElement>(
    '.glossa-theme-swatch, .glossa-theme-name, button',
  )) {
    if (!control.checkVisibility()) continue;
    const rect = control.getBoundingClientRect();
    expect(control.scrollWidth).toBeLessThanOrEqual(control.clientWidth);
    expect(rect.left).toBeGreaterThanOrEqual(sheetBounds.left - 1);
    expect(rect.right).toBeLessThanOrEqual(sheetBounds.right + 1);
    if (control.classList.contains('glossa-theme-swatch')) {
      expect(rect.width).toBeGreaterThanOrEqual(44);
      expect(rect.height).toBeGreaterThanOrEqual(44);
    }
  }
}

function assertSelected(name: string) {
  const radio = screen.getByRole('radio', { name }) as HTMLInputElement;
  expect(radio.checked).toBe(true);
  const swatch = radio.nextElementSibling!;
  const check = swatch.querySelector('.glossa-theme-check');
  expect(check).toBeTruthy();
  if (check) {
    const checkStyle = getComputedStyle(check);
    expect(checkStyle.color).not.toBe(checkStyle.backgroundColor);
    expect(check.checkVisibility()).toBe(true);
    const checkBounds = check.getBoundingClientRect();
    const swatchBounds = swatch.getBoundingClientRect();
    expect(checkBounds.left).toBeGreaterThanOrEqual(swatchBounds.left);
    expect(checkBounds.right).toBeLessThanOrEqual(swatchBounds.right);
    expect(checkBounds.top).toBeGreaterThanOrEqual(swatchBounds.top);
    expect(checkBounds.bottom).toBeLessThanOrEqual(swatchBounds.bottom);
  }
  expect(getComputedStyle(swatch).color).not.toBe(getComputedStyle(swatch).backgroundColor);
  return swatch;
}

it('renders readable previews and cards across wide, 440px, 320px, dark and RTL/e-ink layouts', async () => {
  document.documentElement.lang = 'zh-CN';
  const view = render(<ThemeFixture />);
  const sheet = screen.getByRole('main', { name: '阅读配色设置' });
  expect(screen.getByRole('radiogroup', { name: t('Theme Color') })).toBeTruthy();
  expect(
    view.container.querySelector('[data-setting-id="settings.color.themeColor"]'),
  ).toBeTruthy();
  expect(screen.getAllByRole('radio')).toHaveLength(7);

  for (const scenario of [
    { name: 'light-wide', width: 1080, dark: false, rtl: false, eink: false },
    { name: 'light-440', width: 440, dark: false, rtl: false, eink: false },
    { name: 'light-320', width: 320, dark: false, rtl: false, eink: false },
    { name: 'dark-440', width: 440, dark: true, rtl: false, eink: false },
    { name: 'dark-320', width: 320, dark: true, rtl: false, eink: false },
    { name: 'rtl-eink-320', width: 320, dark: false, rtl: true, eink: true },
    {
      name: 'desktop-narrow-panel',
      width: 1080,
      dark: false,
      rtl: false,
      eink: false,
      panelWidth: 320,
    },
  ]) {
    await page.viewport(scenario.width, 960);
    document.documentElement.setAttribute(
      'data-theme',
      scenario.dark ? 'default-dark' : 'default-light',
    );
    document.documentElement.dir = scenario.rtl ? 'rtl' : 'ltr';
    document.documentElement.setAttribute('data-eink', String(scenario.eink));
    view.rerender(<ThemeFixture dark={scenario.dark} width={scenario.panelWidth} />);
    const preview = screen.getByRole('region', { name: t('Reading preview') });
    const palette = themes[0]!.colors[scenario.dark ? 'dark' : 'light'];
    const probe = document.createElement('span');
    probe.style.backgroundColor = palette['base-100'];
    probe.style.color = palette['base-content'];
    expect(preview.style.backgroundColor).toBe(probe.style.backgroundColor);
    expect(preview.style.color).toBe(probe.style.color);
    const selected = assertSelected(t('Default'));
    assertNoOverflow(sheet);
    if (scenario.eink) {
      expect(getComputedStyle(selected).borderTopWidth).toBe('2px');
      expect(getComputedStyle(selected).boxShadow).toBe('none');
    }
    await document.fonts.ready;
    await Promise.all(
      sheet.getAnimations({ subtree: true }).map((animation) => animation.finished),
    );
    await page.screenshot({
      path: `../../../../../../.glossa-dev/qa/glossa-theme-${scenario.name}.png`,
    });
  }
  await page.viewport(440, 960);
  document.documentElement.setAttribute('data-theme', 'default-light');
  document.documentElement.dir = 'ltr';
  document.documentElement.removeAttribute('data-eink');
  view.rerender(<ThemeFixture includeCustom={false} />);
  assertNoOverflow(sheet);
  await Promise.all(sheet.getAnimations({ subtree: true }).map((animation) => animation.finished));
  await page.screenshot({
    path: '../../../../../../.glossa-dev/qa/glossa-theme-refined-preview.png',
  });
}, 30_000);

it('fits the custom editor and color picker to 320px, 440px and desktop containers', async () => {
  document.documentElement.lang = 'zh-CN';
  document.documentElement.setAttribute('data-theme', 'default-light');
  const save = vi.fn();
  const cancel = vi.fn();
  const baseTheme = themes.find((theme) => theme.name === 'darkreader')!;
  render(
    <div className='glossa-settings'>
      <main
        aria-label='自定义阅读配色'
        className='modal-box settings-content bg-base-200 text-base-content'
        style={{
          position: 'relative',
          width: 440,
          maxWidth: 'calc(100vw - 32px)',
          maxHeight: 'none',
          margin: '24px auto',
          padding: 20,
          transform: 'none',
        }}
      >
        <ThemeEditor
          customTheme={null}
          baseTheme={baseTheme}
          onSave={save}
          onDelete={vi.fn()}
          onCancel={cancel}
        />
      </main>
    </div>,
  );
  const sheet = screen.getByRole('main', { name: '自定义阅读配色' });
  for (const scenario of [
    { name: 'editor-320', viewport: 320, width: 440 },
    { name: 'editor-440', viewport: 440, width: 440 },
    { name: 'editor-desktop-440', viewport: 1080, width: 440 },
    { name: 'editor-wide', viewport: 1080, width: 800 },
  ]) {
    await page.viewport(scenario.viewport, 1100);
    sheet.style.width = `${scenario.width}px`;
    await Promise.all(
      sheet.getAnimations({ subtree: true }).map((animation) => animation.finished),
    );
    await page.screenshot({
      path: `../../../../../../.glossa-dev/qa/glossa-theme-${scenario.name}.png`,
    });
    assertNoOverflow(sheet);
    for (const fieldset of sheet.querySelectorAll('fieldset')) {
      expect(fieldset.scrollWidth).toBeLessThanOrEqual(fieldset.clientWidth);
    }
    for (const control of sheet.querySelectorAll('input, button')) {
      const bounds = control.getBoundingClientRect();
      expect(bounds.left).toBeGreaterThanOrEqual(sheet.getBoundingClientRect().left);
      expect(bounds.right).toBeLessThanOrEqual(sheet.getBoundingClientRect().right);
      expect(
        bounds.height,
        control.getAttribute('aria-label') ?? control.textContent ?? control.tagName,
      ).toBeGreaterThanOrEqual(44);
    }
    const lightPreview = screen.getByRole('region', {
      name: `${t('Light Mode')}: ${t('Preview')}`,
    });
    const probe = document.createElement('span');
    probe.style.backgroundColor = baseTheme.colors.light['base-100'];
    expect(lightPreview.style.backgroundColor).toBe(probe.style.backgroundColor);
    await userEvent.click(
      screen.getByRole('button', { name: `${t('Light Mode')}: ${t('Text Color')}` }),
    );
    assertNoOverflow(sheet);
    const hexInput = screen.getByRole('textbox', { name: '' });
    const bounds = hexInput.getBoundingClientRect();
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(window.innerWidth);
    await userEvent.click(screen.getByRole('textbox', { name: t('Theme Name') }));
  }
  expect(save).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: t('Cancel') }));
  expect(cancel).toHaveBeenCalledOnce();
}, 30_000);

it('uses native arrow and Space selection plus Enter exactly once before dialog key handling', async () => {
  await page.viewport(820, 1000);
  document.documentElement.setAttribute('data-theme', 'default-light');
  const view = render(<ThemeFixture />);
  const host = view.container.firstElementChild!;
  // Dialog stops native bubbling events before React's root delegation.
  const dialogKeyDown = vi.fn((event: Event) => event.stopPropagation());
  host.addEventListener('keydown', dialogKeyDown);
  await userEvent.click(screen.getByRole('button', { name: t('Custom Theme') }));
  await userEvent.keyboard('{Tab}');
  expect(document.activeElement).toBe(screen.getByRole('radio', { name: t('Default') }));
  const focusedSwatch = assertSelected(t('Default'));
  expect(getComputedStyle(focusedSwatch).outlineStyle).toBe('solid');
  expect(getComputedStyle(focusedSwatch).outlineWidth).toBe('2px');
  await page.screenshot({
    path: '../../../../../../.glossa-dev/qa/glossa-theme-keyboard-focus.png',
  });

  dialogKeyDown.mockClear();
  await userEvent.keyboard('{ArrowRight}');
  expect(select).toHaveBeenCalledExactlyOnceWith('darkreader');
  assertSelected(t(themes.find((theme) => theme.name === 'darkreader')!.label));
  expect(dialogKeyDown).not.toHaveBeenCalled();

  select.mockClear();
  const sepia = screen.getByRole('radio', { name: t('Sepia') });
  sepia.focus();
  await userEvent.keyboard(' ');
  expect(select).toHaveBeenCalledExactlyOnceWith('sepia');
  assertSelected(t('Sepia'));
  expect(dialogKeyDown).not.toHaveBeenCalled();

  select.mockClear();
  const nord = screen.getByRole('radio', { name: t('Nord') });
  nord.focus();
  await userEvent.keyboard('{Enter}');
  expect(select).toHaveBeenCalledExactlyOnceWith('nord');
  assertSelected(t('Nord'));
  expect(dialogKeyDown).not.toHaveBeenCalled();
}, 30_000);

it('expands more colors and keeps edit/create separate from theme selection', async () => {
  await page.viewport(320, 960);
  document.documentElement.setAttribute('data-theme', 'default-light');
  render(<ThemeFixture initial={custom.name} />);
  const sheet = screen.getByRole('main', { name: '阅读配色设置' });
  expect(screen.queryByRole('radio', { name: t('Cherry') })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: t('More colors') }));
  expect(
    screen.getByRole('button', { name: t('Fewer colors') }).getAttribute('aria-expanded'),
  ).toBe('true');
  expect(screen.getByRole('radio', { name: t('Cherry') })).toBeTruthy();
  assertNoOverflow(sheet);
  await page.screenshot({ path: '../../../../../../.glossa-dev/qa/glossa-theme-more-320.png' });
  await userEvent.click(screen.getByRole('button', { name: t('Fewer colors') }));
  expect(screen.queryByRole('radio', { name: t('Cherry') })).toBeNull();

  await userEvent.click(screen.getByRole('button', { name: t('Edit') }));
  expect(edit).toHaveBeenCalledExactlyOnceWith(custom.name);
  expect(select).not.toHaveBeenCalled();
  assertSelected(custom.label);
  await userEvent.click(screen.getByRole('button', { name: t('Custom Theme') }));
  expect(create).toHaveBeenCalledOnce();
  expect(select).not.toHaveBeenCalled();

  const more = screen.getByRole('button', { name: t('More colors') });
  await userEvent.click(more);
  const cherry = screen.getByRole('radio', { name: t('Cherry') });
  await userEvent.click(cherry.closest('label')!);
  await waitFor(() => expect(select).toHaveBeenCalledExactlyOnceWith('cherry'));
  assertSelected(t('Cherry'));
  expect(screen.queryByRole('button', { name: t('Edit') })).toBeNull();
}, 30_000);
