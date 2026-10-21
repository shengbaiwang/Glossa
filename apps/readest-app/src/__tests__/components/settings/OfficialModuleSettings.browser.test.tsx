import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { useSettingsStore } from '@/store/settingsStore';
import type { SystemSettings } from '@/types/settings';
import OfficialModuleSettings from '@/components/settings/OfficialModuleSettings';
import '@/styles/globals.css';
import '@/styles/glossa.css';

const f = vi.hoisted(() => ({ save: vi.fn() }));
const zh: Record<string, string> = await (await fetch('/locales/zh-CN/translation.json')).json();
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => zh[key] ?? key,
}));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {} }) }));
vi.mock('@/utils/settingsSync', () => ({ broadcastGlobalSettings: vi.fn() }));
beforeEach(() => {
  f.save.mockReset().mockResolvedValue(undefined);
  useSettingsStore.setState({ settings: {} as SystemSettings, saveSettings: f.save });
});
afterEach(() => {
  cleanup();
  for (const key of ['data-theme', 'dir', 'data-eink'])
    document.documentElement.removeAttribute(key);
});
const fixtures = [
  { theme: 'default-light', width: 760, dir: 'ltr', eink: false },
  { theme: 'default-dark', width: 760, dir: 'ltr', eink: false },
  { theme: 'default-light', width: 390, dir: 'rtl', eink: false },
  { theme: 'default-dark', width: 390, dir: 'rtl', eink: true },
] as const;
it.each(
  fixtures,
)('operates the module rows with pointer and keyboard in $theme / $width / $dir', async (fixture) => {
  await page.viewport(fixture.width, 600);
  document.documentElement.setAttribute('data-theme', fixture.theme);
  document.documentElement.dir = fixture.dir;
  document.documentElement.setAttribute('data-eink', String(fixture.eink));
  const view = render(
    <main className='settings-content bg-base-200 text-base-content min-h-screen space-y-6 p-6'>
      <button type='button'>设置</button>
      <OfficialModuleSettings />
    </main>,
  );
  const conversation = screen.getByRole('checkbox', { name: '对话' }) as HTMLInputElement;
  const mindmap = screen.getByRole('checkbox', { name: '导图' }) as HTMLInputElement;
  expect(conversation.checked).toBe(true);
  expect(mindmap.checked).toBe(true);
  await userEvent.click(screen.getByRole('button', { name: '设置' }));
  await userEvent.tab();
  expect(document.activeElement).toBe(conversation);
  await userEvent.keyboard(' ');
  await waitFor(() => expect(conversation.disabled).toBe(false));
  expect(conversation.checked).toBe(false);
  expect(f.save).toHaveBeenCalledOnce();
  await userEvent.click(mindmap.closest('label')!, { position: { x: 8, y: 24 } });
  await waitFor(() => expect(mindmap.disabled).toBe(false));
  expect(mindmap.checked).toBe(false);
  expect(useSettingsStore.getState().settings.officialModules).toEqual({
    conversation: false,
    mindmap: false,
  });
  const pdf = screen.getByRole('checkbox', { name: 'PDF 自动目录' }) as HTMLInputElement;
  expect(pdf.checked).toBe(true);
  await userEvent.click(pdf);
  await waitFor(() => expect(pdf.disabled).toBe(false));
  expect(pdf.checked).toBe(false);
  expect(useSettingsStore.getState().settings.officialModules?.pdfAutoContents).toBe(false);
  for (const row of view.container.querySelectorAll('.glossa-settings-row'))
    expect(row.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  await page.screenshot({
    path: `../../../../../../.glossa-dev/qa/official-modules-${fixture.theme}-${fixture.dir}-${fixture.eink}.png`,
  });
});
it('restores a failed preference save and permits a fresh click to retry', async () => {
  await page.viewport(390, 600);
  document.documentElement.setAttribute('data-theme', 'default-light');
  f.save.mockRejectedValueOnce(new Error('Isolated write failure'));
  render(
    <main className='settings-content bg-base-200 text-base-content min-h-screen space-y-6 p-6'>
      <OfficialModuleSettings />
    </main>,
  );
  await userEvent.click(screen.getByRole('checkbox', { name: '对话' }));
  await screen.findByRole('alert');
  expect((screen.getByRole('checkbox', { name: '对话' }) as HTMLInputElement).checked).toBe(true);
  await userEvent.click(screen.getByRole('checkbox', { name: '对话' }));
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect((screen.getByRole('checkbox', { name: '对话' }) as HTMLInputElement).checked).toBe(false);
  expect(f.save).toHaveBeenCalledTimes(2);
});
