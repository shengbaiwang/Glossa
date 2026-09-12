import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import type { ProviderConfig } from '@/glossa/ai/provider';
import ModelSettingsPanel from '@/glossa/ui/ModelSettingsPanel';
import '@/styles/globals.css';
import '@/styles/glossa.css';

const zh: Record<string, string> = await (await fetch('/locales/zh-CN/translation.json')).json();
const fixture = vi.hoisted(() => ({
  config: {
    id: 'custom',
    name: '本地测试服务',
    baseUrl: 'https://models.example/v1',
    model: 'study-fixture',
  },
  hasKey: false,
  saved: [] as ProviderConfig[],
  save: vi.fn(),
  models: vi.fn(),
  test: vi.fn(),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => zh[key] || key,
}));
vi.mock('@/services/environment', () => ({ isTauriAppPlatform: () => false }));
// Fully replace the provider: this browser test never reads credentials or saved settings,
// and model discovery / connection checks cannot make a network request.
vi.mock('@/glossa/ai/provider', () => ({
  ModelServiceError: class extends Error {},
  PROVIDER_PRESETS: [fixture.config],
  getActiveProviderConfig: () => ({ ...fixture.config }),
  getSavedProviderConfigs: () => fixture.saved,
  getProviderStatus: async () => ({
    configured: true,
    hasApiKey: fixture.hasKey,
    storage: 'session',
  }),
  clearProviderApiKey: vi.fn(),
  saveProviderConfig: fixture.save,
  listProviderModels: fixture.models,
  testProviderConnection: fixture.test,
}));

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('lang');
});

it('renders Chinese model settings with real Glossa styles and usable controls without horizontal overflow', async () => {
  await page.viewport(820, 900);
  document.documentElement.setAttribute('data-theme', 'default-light');
  document.documentElement.lang = 'zh-CN';
  fixture.hasKey = false;
  fixture.saved = [{ ...fixture.config }];
  fixture.save.mockImplementation(async (config: ProviderConfig, key?: string) => {
    fixture.hasKey ||= Boolean(key);
    fixture.saved = [...fixture.saved.filter((item) => item.id !== config.id), config];
    return config;
  });
  fixture.models.mockResolvedValue(['study-fixture', 'notes-fixture']);
  fixture.test.mockResolvedValue(undefined);

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
        <ModelSettingsPanel />
      </main>
    </div>,
  );
  const sheet = view.container.querySelector('main')!;
  const keyInput = screen.getByLabelText('API 密钥') as HTMLInputElement;
  expect(keyInput.type).toBe('password');
  fireEvent.change(keyInput, { target: { value: 'synthetic-test-key' } });
  fireEvent.click(screen.getByRole('button', { name: '获取模型' }));
  const modelPicker = await screen.findByRole('combobox', { name: '可用模型' });
  fireEvent.change(modelPicker, { target: { value: 'notes-fixture' } });
  expect((screen.getByLabelText('模型名称') as HTMLInputElement).value).toBe('notes-fixture');
  fireEvent.click(screen.getByRole('button', { name: '检测连接' }));
  await screen.findByText('连接成功，可以使用此模型生成导读。');
  expect(fixture.test).toHaveBeenCalledOnce();
  expect(fixture.test.mock.calls[0]![0].model).toBe('notes-fixture');
  expect(keyInput.value).toBe('');
  expect((screen.getByLabelText('API 地址') as HTMLInputElement).value).toBe(
    'https://models.example/v1',
  );
  for (const label of ['使用此服务', '获取模型', '检测连接']) {
    await waitFor(() =>
      expect(screen.getByRole('button', { name: label }).hasAttribute('disabled')).toBe(false),
    );
  }
  expect(getComputedStyle(sheet).fontSize).toBe('14px');
  expect(getComputedStyle(screen.getByRole('button', { name: '使用此服务' })).borderRadius).toBe(
    '12px',
  );
  const picker = screen.getByRole('combobox', { name: '模型服务' });
  const add = screen.getByRole('option', { name: '添加自定义服务' }) as HTMLOptionElement;
  for (const name of ['研究服务', '备用服务']) {
    fireEvent.change(picker, { target: { value: add.value } });
    fireEvent.change(screen.getByLabelText('服务名称'), { target: { value: name } });
    fireEvent.change(screen.getByLabelText('API 地址'), {
      target: { value: 'https://models.example/v1' },
    });
    fireEvent.click(screen.getByRole('button', { name: '使用此服务' }));
    await screen.findByRole('option', { name });
    await waitFor(() => expect(picker.hasAttribute('disabled')).toBe(false));
  }
  expect(fixture.saved).toHaveLength(3);
  expect(screen.getByRole('option', { name: '本地测试服务' })).toBeTruthy();
  expect(screen.getByRole('option', { name: '研究服务' })).toBeTruthy();
  expect(screen.getByRole('option', { name: '备用服务' })).toBeTruthy();
  const assertNoOverflow = () => {
    expect(sheet.scrollWidth).toBeLessThanOrEqual(sheet.clientWidth);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
    const bounds = sheet.getBoundingClientRect();
    for (const control of sheet.querySelectorAll('input, select, button')) {
      const rect = control.getBoundingClientRect();
      expect(rect.left).toBeGreaterThanOrEqual(bounds.left);
      expect(rect.right).toBeLessThanOrEqual(bounds.right);
    }
  };
  assertNoOverflow();
  await page.screenshot({ path: '../../../../../.glossa-dev/qa/model-settings.png' });
  await page.viewport(390, 844);
  assertNoOverflow();
  expect(getComputedStyle(sheet).fontSize).toBe('16px');
}, 30_000);
