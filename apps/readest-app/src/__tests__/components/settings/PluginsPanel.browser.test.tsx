import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { useSettingsStore } from '@/store/settingsStore';
import type { SystemSettings } from '@/types/settings';
import PluginsPanel from '@/components/settings/PluginsPanel';
import '@/styles/globals.css';
import '@/styles/glossa.css';

const f = vi.hoisted(() => ({
  save: vi.fn(),
  providerSave: vi.fn(),
  models: vi.fn(),
  test: vi.fn(),
}));
const zh: Record<string, string> = await (await fetch('/locales/zh-CN/translation.json')).json();
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => zh[key] ?? key,
}));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {} }) }));
vi.mock('@/utils/settingsSync', () => ({ broadcastGlobalSettings: vi.fn() }));
// Keep the actual settings UI; replace credential and network boundaries.
vi.mock('@/glossa/ai/provider', () => ({
  ModelServiceError: class extends Error {},
  PROVIDER_PRESETS: [
    { id: 'fixture', name: '本地测试服务', baseUrl: 'https://models.example/v1', model: 'fixture' },
  ],
  getActiveProviderConfig: () => ({
    id: 'fixture',
    name: '本地测试服务',
    baseUrl: 'https://models.example/v1',
    model: 'fixture',
  }),
  getSavedProviderConfigs: () => [],
  getProviderStatus: async () => ({ configured: true, hasApiKey: false, storage: 'session' }),
  clearProviderApiKey: vi.fn(),
  saveProviderConfig: f.providerSave,
  listProviderModels: f.models,
  testProviderConnection: f.test,
  providerCapabilities: () => ({ reasoningEfforts: [], maxTokensParam: 'max_tokens' }),
}));
beforeEach(() => {
  f.save.mockReset().mockResolvedValue(undefined);
  useSettingsStore.setState({ settings: {} as SystemSettings, saveSettings: f.save });
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  for (const key of ['data-theme', 'dir', 'data-eink'])
    document.documentElement.removeAttribute(key);
});

it.each([
  { theme: 'default-light', width: 760, dir: 'ltr', eink: false },
  { theme: 'default-dark', width: 760, dir: 'ltr', eink: false },
  { theme: 'default-dark', width: 390, dir: 'ltr', eink: false },
  { theme: 'default-light', width: 390, dir: 'rtl', eink: true },
])('opens plugin settings from accessible grid cards in $theme / $width / $dir', async (fixture) => {
  await page.viewport(fixture.width, 840);
  document.documentElement.setAttribute('data-theme', fixture.theme);
  document.documentElement.dir = fixture.dir;
  document.documentElement.setAttribute('data-eink', String(fixture.eink));
  const view = render(
    <main className='glossa-settings settings-content bg-base-200 text-base-content min-h-screen p-6'>
      <PluginsPanel />
    </main>,
  );
  const cards = [...view.container.querySelectorAll('.glossa-plugin-card')];
  expect(cards).toHaveLength(3);
  if (fixture.width === 760) {
    expect(cards[0]!.getBoundingClientRect().top).toBe(cards[1]!.getBoundingClientRect().top);
    expect(cards[0]!.getBoundingClientRect().left).not.toBe(cards[1]!.getBoundingClientRect().left);
  }
  for (const card of cards) {
    const button = card.querySelector('button')!;
    const rect = button.getBoundingClientRect();
    const bounds = card.getBoundingClientRect();
    expect(rect.height).toBeGreaterThanOrEqual(44);
    expect(rect.width).toBeGreaterThanOrEqual(44);
    expect(rect.top - bounds.top).toBeLessThanOrEqual(16);
    expect(
      fixture.dir === 'rtl' ? rect.left - bounds.left : bounds.right - rect.right,
    ).toBeLessThanOrEqual(16);
  }
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  await page.screenshot({
    path: `../../../../../../.glossa-dev/qa/plugin-grid-${fixture.theme}-${fixture.width}-${fixture.dir}.png`,
  });
  const more = screen.getByRole('button', { name: '对话 - 设置' });
  await userEvent.click(more);
  await screen.findByRole('button', { name: '新建提示词' });
  await userEvent.click(screen.getByRole('button', { name: '模型服务' }));
  await screen.findByRole('textbox', { name: 'API 地址' });
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  await page.screenshot({
    path: `../../../../../../.glossa-dev/qa/plugin-settings-${fixture.width}-${fixture.dir}.png`,
  });
  await userEvent.click(screen.getByRole('button', { name: '返回插件' }));
  const restored = screen.getByRole('button', { name: '对话 - 设置' });
  expect(document.activeElement).toBe(restored);
  await userEvent.keyboard('{Enter}');
  await screen.findByRole('button', { name: '新建提示词' });
  await userEvent.click(screen.getByRole('button', { name: '返回插件' }));
  await userEvent.click(screen.getByRole('button', { name: 'PDF 自动目录 - 设置' }));
  const onImport = screen.getByRole('checkbox', { name: '导入时自动生成目录' }) as HTMLInputElement;
  await userEvent.click(onImport);
  await waitFor(() => expect(onImport.disabled).toBe(false));
  expect(onImport.checked).toBe(false);
  expect(useSettingsStore.getState().settings.officialModules).toBeUndefined();
  expect(f.providerSave).not.toHaveBeenCalled();
  expect(f.models).not.toHaveBeenCalled();
  expect(f.test).not.toHaveBeenCalled();
});
