import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import ThemeColorSelector from '@/components/settings/theme/ThemeColorSelector';
import { themes, type Theme } from '@/styles/themes';
import { getLocale } from '@/utils/misc';

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/utils/misc', () => ({ getLocale: vi.fn(() => 'zh-CN') }));

beforeEach(() => vi.mocked(getLocale).mockReturnValue('zh-CN'));
afterEach(cleanup);

const custom: Theme = { ...themes[0]!, name: 'my-paper', label: 'My paper', isCustomizable: true };
const props = () => ({
  themes: [...themes, custom],
  themeColor: 'default',
  isDarkMode: false,
  onThemeColorChange: vi.fn(),
  onEditTheme: vi.fn(),
  onCreateTheme: vi.fn(),
});

describe('Glossa theme choices', () => {
  it('pairs the requested Chinese verse with the original Latin line', () => {
    const latin = 'Sunt lacrimae rerum et mentem mortalia tangunt.';
    const { rerender } = render(<ThemeColorSelector {...props()} />);
    const preview = screen.getByRole('region', { name: 'Reading preview' });
    expect(preview.querySelector('p')?.textContent).toBe('微雨从东来，好风与之俱');
    expect(preview.querySelector('p')?.lang).toBe('zh-Hans');
    expect(preview.querySelector('.glossa-theme-preview-accent')?.textContent).toBe(latin);
    expect(preview.querySelector('.glossa-theme-preview-accent')?.getAttribute('lang')).toBe('la');

    vi.mocked(getLocale).mockReturnValue('zh-TW');
    rerender(<ThemeColorSelector {...props()} isDarkMode />);
    expect(preview.querySelector('p')?.textContent).toBe('微雨從東來，好風與之俱');
    expect(preview.querySelector('p')?.lang).toBe('zh-Hant');
    expect(preview.querySelector('.glossa-theme-preview-accent')?.textContent).toBe(latin);

    vi.mocked(getLocale).mockReturnValue('en-US');
    rerender(<ThemeColorSelector {...props()} />);
    expect(preview.querySelector('p')?.textContent).toBe(latin);
    expect(preview.querySelector('p')?.lang).toBe('la');
    expect(preview.querySelector('.glossa-theme-preview-accent')).toBeNull();
  });

  it('exposes one native radio group and selects a preset only once', () => {
    const handlers = props();
    const { container } = render(<ThemeColorSelector {...handlers} />);
    expect(screen.getByRole('radiogroup', { name: 'Theme Color' })).toBeTruthy();
    expect((screen.getByRole('radio', { name: 'Default' }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: 'Sepia' }));
    expect(handlers.onThemeColorChange).toHaveBeenCalledExactlyOnceWith('sepia');
    expect(container.querySelector('button button')).toBeNull();
  });

  it('previews the actual selected palette in each appearance', () => {
    const { rerender } = render(<ThemeColorSelector {...props()} themeColor='sepia' />);
    const preview = screen.getByRole('region', { name: 'Reading preview' });
    const color = themes.find((theme) => theme.name === 'sepia')!.colors;
    const probe = document.createElement('div');
    probe.style.backgroundColor = color.light['base-100'];
    expect(preview.style.backgroundColor).toBe(probe.style.backgroundColor);
    rerender(<ThemeColorSelector {...props()} themeColor='sepia' isDarkMode />);
    probe.style.backgroundColor = color.dark['base-100'];
    expect(preview.style.backgroundColor).toBe(probe.style.backgroundColor);
  });

  it('reveals additional palettes and keeps a restored additional selection visible', () => {
    const { rerender } = render(<ThemeColorSelector {...props()} />);
    expect(screen.queryByRole('radio', { name: 'Cherry' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'More colors' }));
    expect(screen.getByRole('radio', { name: 'Cherry' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Fewer colors' }));
    rerender(<ThemeColorSelector {...props()} themeColor='cherry' />);
    expect((screen.getByRole('radio', { name: 'Cherry' }) as HTMLInputElement).checked).toBe(true);
  });

  it('edits a selected custom palette without changing selection, and starts a new one separately', () => {
    const handlers = props();
    render(<ThemeColorSelector {...handlers} themeColor={custom.name} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(handlers.onEditTheme).toHaveBeenCalledExactlyOnceWith(custom.name);
    expect(handlers.onThemeColorChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Custom Theme' }));
    expect(handlers.onCreateTheme).toHaveBeenCalledOnce();
  });

  it('forwards the settings search anchor', () => {
    const { container } = render(
      <ThemeColorSelector {...props()} data-setting-id='settings.color.themeColor' />,
    );
    expect(container.querySelector('[data-setting-id="settings.color.themeColor"]')).toBeTruthy();
  });
});
