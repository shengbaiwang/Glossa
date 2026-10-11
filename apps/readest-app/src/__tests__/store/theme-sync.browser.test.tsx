import { act, cleanup, render, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useThemeStyles, useTheme } from '@/hooks/useTheme';
import { useThemeStore, initSystemThemeListener, loadDataTheme } from '@/store/themeStore';
import { useSettingsStore } from '@/store/settingsStore';
import type { AppService } from '@/types/system';
import type { CustomTheme } from '@/styles/themes';
import '@/styles/globals.css';
import '@/styles/glossa.css';

vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: null }) }));
vi.mock('@/hooks/useSafeAreaInsets', () => ({
  useSafeAreaInsets: () => ({ onUpdateInsets: vi.fn() }),
}));
vi.mock('@/services/environment', async (original) => ({
  ...(await original<typeof import('@/services/environment')>()),
  isWebAppPlatform: () => true,
}));

let stopListening: (() => void) | undefined;
let frame: HTMLIFrameElement | undefined;
const originalSettings = useSettingsStore.getState().settings;
beforeEach(() => {
  localStorage.clear();
  useSettingsStore.setState({ settings: originalSettings });
  loadDataTheme();
});
afterEach(() => {
  cleanup();
  stopListening?.();
  stopListening = undefined;
  frame?.remove();
  frame = undefined;
  useSettingsStore.setState({ settings: originalSettings });
  document.getElementById('theme-browser-paper-styles')?.remove();
  document.querySelector('meta[name="theme-color"]')?.remove();
});

it('switches actual themed controls together with the page surface', async () => {
  renderHook(() => useThemeStyles());
  const { container } = render(
    <>
      <button className='glossa-icon-button'>Theme</button>
      <span className='text-base-content'>Ink</span>
    </>,
  );
  const button = container.querySelector('button')!;
  const ink = container.querySelector('span')!;
  expect(getComputedStyle(button).color).toBe(getComputedStyle(ink).color);
  await expect
    .poll(() => document.documentElement.classList.contains('theme-changing'))
    .toBe(false);
  const duration = getComputedStyle(button).transitionDuration;
  act(() => useThemeStore.getState().setThemeMode('dark'));
  expect(getComputedStyle(button).color).toBe(getComputedStyle(ink).color);
  expect(document.documentElement.style.colorScheme).toBe('dark');
  act(() => {
    useThemeStore.getState().setThemeMode('light');
    useThemeStore.getState().setThemeMode('dark');
  });
  expect(getComputedStyle(button).color).toBe(getComputedStyle(ink).color);
  await expect
    .poll(() => document.documentElement.classList.contains('theme-changing'))
    .toBe(false);
  expect(getComputedStyle(button).transitionDuration).toBe(duration);
});

it('receives a real storage event from another browsing context', async () => {
  stopListening = initSystemThemeListener({ hasAmbientLightSensor: false } as AppService);
  frame = document.createElement('iframe');
  document.body.append(frame);
  frame.contentWindow!.localStorage.setItem('themeMode', 'dark');
  await expect.poll(() => useThemeStore.getState().isDarkMode).toBe(true);
  expect(useThemeStore.getState().themeCode.isDarkMode).toBe(true);
  expect(document.documentElement.getAttribute('data-theme')).toBe('default-dark');
});

it('keeps cached custom themes until settings load, then updates the active palette before painting', () => {
  const custom: CustomTheme = {
    name: 'browser-paper',
    label: 'Browser paper',
    colors: {
      light: { bg: '#f4ead6', fg: '#352e24', primary: '#53452f' },
      dark: { bg: '#25211b', fg: '#e7ddcc', primary: '#c1b391' },
    },
  };
  localStorage.setItem('customThemes', JSON.stringify([custom]));
  localStorage.setItem('themeColor', custom.name);
  loadDataTheme();
  renderHook(() => useThemeStyles());
  expect(JSON.parse(localStorage.getItem('customThemes')!)).toEqual([custom]);
  const edited = {
    ...custom,
    colors: { ...custom.colors, light: { ...custom.colors.light, bg: '#eeeeee' } },
  };
  act(() =>
    useSettingsStore.setState({
      settings: {
        ...originalSettings,
        globalReadSettings: { ...originalSettings.globalReadSettings, customThemes: [edited] },
      },
    }),
  );
  expect(useThemeStore.getState().themeCode.bg).toBe('#eeeeee');
  const { container } = render(<div className='bg-base-100'>Page</div>);
  expect(getComputedStyle(container.firstElementChild!).backgroundColor).toBe(
    'oklch(0.949119 0 0)',
  );
});

it('keeps the browser toolbar color current after switching modes and pages', () => {
  const meta = document.createElement('meta');
  meta.name = 'theme-color';
  document.head.append(meta);
  const { rerender } = renderHook(
    ({ color }: { color: 'base-100' | 'base-200' }) => useTheme({ appThemeColor: color }),
    { initialProps: { color: 'base-100' } },
  );
  act(() => useThemeStore.getState().setThemeMode('dark'));
  expect(meta.content).toBe(useThemeStore.getState().themeCode.bg);
  rerender({ color: 'base-200' });
  expect(meta.content).toBe(useThemeStore.getState().themeCode.palette['base-200']);
});
