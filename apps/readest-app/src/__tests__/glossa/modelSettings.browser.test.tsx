import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import {
  activateProviderConfig,
  getActiveProviderConfig,
  getProviderModelConfig,
  getSavedProviderConfigs,
  saveProviderConfig,
  setProviderModelFavorite,
} from '@/glossa/ai/provider';
import ModelSettingsPanel from '@/glossa/ui/ModelSettingsPanel';
import ConversationModelPicker from '@/glossa/ui/ConversationModelPicker';
import '@/styles/globals.css';
import '@/styles/glossa.css';

const zh: Record<string, string> = await (await fetch('/locales/zh-CN/translation.json')).json();
const fixture = vi.hoisted(() => ({
  secrets: new Map<string, string>(),
  reads: vi.fn(),
  metadata: vi.fn(),
  network: vi.fn(),
  reject: false,
}));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => zh[key] || key,
}));
vi.mock('@/services/environment', () => ({ isTauriAppPlatform: () => true }));
vi.mock('@/utils/bridge', () => ({
  getSecureItem: fixture.reads,
  getSecureItemStatus: fixture.metadata,
  setSecureItem: async ({ key, value }: { key: string; value: string }) => {
    fixture.secrets.set(key, value);
    return { success: true };
  },
  clearSecureItem: async ({ key }: { key: string }) => {
    fixture.secrets.delete(key);
    return { success: true };
  },
}));
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: fixture.network }));
const config = {
  id: 'custom-fixture',
  name: '研究服务',
  baseUrl: 'https://models.example/v1',
  model: 'reader-model',
};

beforeEach(() => {
  localStorage.clear();
  fixture.secrets.clear();
  fixture.reject = false;
  fixture.reads
    .mockReset()
    .mockImplementation(async ({ key }: { key: string }) => ({ value: fixture.secrets.get(key) }));
  fixture.metadata.mockReset().mockImplementation(async ({ key }: { key: string }) => ({
    status: fixture.secrets.has(key) ? 'present' : 'missing',
  }));
  fixture.network.mockReset().mockImplementation(async (url: string) => {
    if (fixture.reject) return new Response('', { status: 503 });
    if (url.endsWith('/models'))
      return new Response(JSON.stringify({ data: [{ id: 'reader-model' }, { id: 'map-model' }] }));
    return new Response(
      'data: {"choices":[{"delta":{"content":"OK"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
      { headers: { 'Content-Type': 'text/event-stream' } },
    );
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-eink');
  document.documentElement.removeAttribute('dir');
  document.documentElement.removeAttribute('lang');
});
async function seed() {
  await saveProviderConfig(config, 'synthetic-test-key');
  await activateProviderConfig(config, 'conversation');
  await activateProviderConfig(config, 'mindmap');
  fixture.reads.mockClear();
  fixture.network.mockClear();
}
function settings() {
  return render(
    <div className='glossa-settings'>
      <main
        className='modal-box settings-content bg-base-200'
        style={{
          position: 'relative',
          width: 560,
          maxWidth: 'calc(100vw - 32px)',
          maxHeight: 'calc(100dvh - 48px)',
          overflowY: 'auto',
          margin: '24px auto',
          padding: 24,
          transform: 'none',
        }}
      >
        <ModelSettingsPanel />
      </main>
    </div>,
  );
}
const t = (key: string) => zh[key] || key;
const screenshotRoot = `../../../../../.glossa-dev/qa/model-management-20261030/${process.env['NEXT_PUBLIC_APP_PLATFORM'] === 'tauri' ? 'tauri-' : ''}`;

it('opens and edits without reading secrets; testing a draft never saves or changes either default', async () => {
  await seed();
  settings();
  await waitFor(() =>
    expect((screen.getByLabelText(t('API Key')) as HTMLInputElement).placeholder).toBe(
      t('Key saved. Leave blank to keep it.'),
    ),
  );
  fireEvent.change(screen.getByLabelText(t('Service name')), { target: { value: '草稿服务' } });
  fireEvent.change(screen.getByLabelText(t('Model name')), { target: { value: 'draft-model' } });
  fireEvent.change(screen.getByLabelText(t('Output limit')), { target: { value: '2048' } });
  expect(fixture.reads).not.toHaveBeenCalled();
  expect(fixture.network).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText(t('API Key')), {
    target: { value: 'synthetic-draft-key' },
  });
  fireEvent.click(screen.getByRole('button', { name: t('Test connection') }));
  await screen.findByText(t('Chat connection successful.'));
  expect(fixture.reads).not.toHaveBeenCalled();
  expect(getActiveProviderConfig('conversation')?.model).toBe('reader-model');
  expect(getActiveProviderConfig('mindmap')?.model).toBe('reader-model');
  expect(getSavedProviderConfigs()[0]?.name).toBe('研究服务');
  expect((screen.getByLabelText(t('API Key')) as HTMLInputElement).value).toBe(
    'synthetic-draft-key',
  );
  fixture.reject = true;
  fireEvent.click(screen.getByRole('button', { name: t('Test connection') }));
  await screen.findByRole('alert');
  expect(getActiveProviderConfig('conversation')?.model).toBe('reader-model');
  expect(getActiveProviderConfig('mindmap')?.model).toBe('reader-model');
});

it('keeps multiple model parameters and independent defaults and preserves drafts after save failure', async () => {
  await seed();
  settings();
  fireEvent.change(screen.getByLabelText(t('Model name')), { target: { value: 'map-model' } });
  fireEvent.change(screen.getByLabelText(t('Output limit')), { target: { value: '4096' } });
  const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('Synthetic storage failure');
  });
  fireEvent.click(screen.getByRole('button', { name: t('Save service') }));
  await screen.findByRole('alert');
  expect((screen.getByLabelText(t('Model name')) as HTMLInputElement).value).toBe('map-model');
  expect((screen.getByLabelText(t('Output limit')) as HTMLInputElement).value).toBe('4096');
  expect(getActiveProviderConfig('conversation')?.model).toBe('reader-model');
  write.mockRestore();
  fireEvent.click(screen.getByRole('button', { name: t('Save service') }));
  await screen.findByText(t('Model service saved.'));
  fireEvent.click(screen.getByRole('button', { name: t('Use for mind maps') }));
  await screen.findByText(t('Default model updated.'));
  expect(getActiveProviderConfig('conversation')?.model).toBe('reader-model');
  expect(getActiveProviderConfig('mindmap')).toMatchObject({ model: 'map-model', maxTokens: 4096 });
  fireEvent.click(screen.getByRole('button', { name: 'reader-model' }));
  expect((screen.getByLabelText(t('Output limit')) as HTMLInputElement).value).toBe('');
  expect(getProviderModelConfig(config, 'map-model').maxTokens).toBe(4096);
  expect(fixture.reads).not.toHaveBeenCalled();
});

it('opens the cached picker without network or secrets, supports favorite/search and retries discovery failures', async () => {
  await seed();
  await saveProviderConfig({ ...config, model: 'map-model', maxTokens: 2048 });
  setProviderModelFavorite(config, 'map-model', true);
  const view = render(
    <ConversationModelPicker config={config} ready openSettings={vi.fn()} purpose='mindmap' />,
  );
  fireEvent.click(screen.getByRole('button', { name: t('Choose model') }));
  expect(fixture.network).not.toHaveBeenCalled();
  expect(fixture.reads).not.toHaveBeenCalled();
  const targets = Array.from(
    screen.getByRole('dialog').querySelectorAll('button, input, select'),
  ).map((control) => {
    const style = getComputedStyle(control);
    return {
      tag: control.tagName,
      class: control.className,
      height: control.getBoundingClientRect().height,
      minHeight: style.minHeight,
      computedHeight: style.height,
      zoom: style.zoom,
    };
  });
  for (const target of targets)
    expect(target.height, JSON.stringify(targets)).toBeGreaterThanOrEqual(44);
  expect(
    screen
      .getByRole('button', { name: t('Favorite model') + ': map-model' })
      .getAttribute('aria-pressed'),
  ).toBe('true');
  fireEvent.change(screen.getByLabelText(t('Search or enter model')), { target: { value: 'map' } });
  expect(screen.queryByRole('button', { name: 'reader-model' })).toBeNull();
  fixture.reject = true;
  fireEvent.click(screen.getByRole('button', { name: t('Refresh models') }));
  await screen.findByRole('alert');
  expect(screen.getByRole('button', { name: 'map-model' })).toBeTruthy();
  fixture.reject = false;
  fireEvent.click(screen.getByRole('button', { name: t('Refresh models') }));
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  await waitFor(() =>
    expect(screen.getByRole('button', { name: t('Refresh models') }).hasAttribute('disabled')).toBe(
      false,
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: 'map-model' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(getActiveProviderConfig('mindmap')).toMatchObject({ model: 'map-model', maxTokens: 2048 });
  expect(getActiveProviderConfig('conversation')?.model).toBe('reader-model');
  view.unmount();
  fixture.network.mockClear();
  fixture.reads.mockClear();
  render(
    <ConversationModelPicker
      config={getActiveProviderConfig('mindmap')}
      ready
      openSettings={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: t('Choose model') }));
  expect(fixture.network).not.toHaveBeenCalled();
  expect(fixture.reads).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByLabelText(t('Search or enter model')), { key: 'Escape' });
  expect(document.activeElement).toBe(screen.getByRole('button', { name: t('Choose model') }));
});

it('renders paper and ink controls without overflow on desktop, narrow RTL and e-ink', async () => {
  await seed();
  await page.viewport(820, 1000);
  document.documentElement.setAttribute('data-theme', 'default-light');
  document.documentElement.lang = 'zh-CN';
  const view = settings();
  await screen.findByRole('button', { name: 'reader-model' });
  const sheet = view.container.querySelector('main')!;
  const assertNoOverflow = () => {
    expect(sheet.scrollWidth).toBeLessThanOrEqual(sheet.clientWidth);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
    const bounds = sheet.getBoundingClientRect();
    for (const control of sheet.querySelectorAll('input, select, button')) {
      const rect = control.getBoundingClientRect();
      if (!rect.width) continue;
      expect(rect.left).toBeGreaterThanOrEqual(bounds.left);
      expect(rect.right).toBeLessThanOrEqual(bounds.right + 1);
    }
  };
  assertNoOverflow();
  await page.screenshot({
    save: true,
    path: `${screenshotRoot}settings-light.png`,
  });
  await page.viewport(390, 844);
  if (process.env['NEXT_PUBLIC_APP_PLATFORM'] === 'tauri')
    console.warn('WKWebView model settings viewport', {
      requested: [390, 844],
      actual: [window.innerWidth, window.innerHeight],
    });
  document.documentElement.setAttribute('dir', 'rtl');
  document.documentElement.setAttribute('data-theme', 'default-dark');
  assertNoOverflow();
  for (const label of [
    'Save service',
    'Test connection',
    'Use for conversation',
    'Use for mind maps',
  ]) {
    expect(
      screen.getByRole('button', { name: t(label) }).getBoundingClientRect().height,
    ).toBeGreaterThanOrEqual(44);
  }
  await page.screenshot({
    save: true,
    path: `${screenshotRoot}settings-narrow-dark-rtl.png`,
  });
  sheet.scrollTop = sheet.scrollHeight;
  await page.screenshot({
    save: true,
    path: `${screenshotRoot}settings-narrow-dark-rtl-actions.png`,
  });
  document.documentElement.setAttribute('data-eink', 'true');
  assertNoOverflow();
  await page.screenshot({
    save: true,
    path: `${screenshotRoot}settings-eink.png`,
  });
});
