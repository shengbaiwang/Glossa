import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import ImportFromFolderDialog from '@/app/library/components/ImportFromFolderDialog';
import '@/styles/globals.css';
import '@/styles/glossa.css';
import '@/styles/glossa-library.css';

const translations: Record<string, string> = {
  'Import folder': '导入文件夹',
  Change: '更换',
  Cancel: '取消',
  'Keep subfolder groups': '保留子文件夹分组',
  Close: '关闭',
  'Import {{count}} books': '导入 {{count}} 本',
  'Found {{count}} books': '发现 {{count}} 本书',
  'Importing {{completed}} of {{total}} books…': '正在导入 {{completed}} / {{total}} 本…',
  'Scanning folder…': '正在扫描文件夹…',
  'Stopping…': '正在停止…',
};
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, values?: Record<string, string | number>) =>
    (translations[key] ?? key).replace(/{{(\w+)}}/g, (_match, name) =>
      String(values?.[name] ?? ''),
    ),
}));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: {} }) }));
vi.mock('@/utils/rtl', () => ({
  getDirFromUILanguage: () => document.documentElement.dir || 'ltr',
}));

const files = [
  { path: 'history/book.epub', size: 100 },
  { path: 'history/book.pdf', size: 200 },
  { path: 'short.md', size: 20 },
];
const scan = vi.fn().mockResolvedValue(files);
afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-eink');
  document.documentElement.removeAttribute('dir');
});

it.each([
  ['default-light', 900, 'ltr', false],
  ['default-dark', 900, 'ltr', false],
  ['default-light', 390, 'ltr', false],
  ['default-dark', 390, 'rtl', true],
] as const)('keeps a compact accessible sheet in %s / %s / %s / eink=%s', async (theme, width, dir, eink) => {
  await page.viewport(width, 720);
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.setAttribute('data-eink', String(eink));
  document.documentElement.dir = dir;
  render(
    <ImportFromFolderDialog
      initialDirectory='/Users/reader/Books/历史与思想/一个很长的文件夹名称'
      onScanDirectory={scan}
      onPickDirectory={vi.fn()}
      onCancel={vi.fn()}
      onConfirm={vi.fn().mockResolvedValue(undefined)}
    />,
  );
  await screen.findByRole('button', { name: '导入 3 本' });
  const surface = document.querySelector('.glossa-folder-import-dialog')!;
  const bounds = surface.getBoundingClientRect();
  expect(bounds.width).toBeLessThanOrEqual(Math.min(width, 480));
  expect(bounds.height).toBeLessThan(420);
  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThanOrEqual(width);
  expect(surface.scrollWidth).toBeLessThanOrEqual(surface.clientWidth);
  expect(screen.getAllByRole('checkbox')).toHaveLength(1);
  await userEvent.click(screen.getByRole('checkbox', { name: '保留子文件夹分组' }));
  expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
  await page.screenshot({
    path: `../../../../../../.glossa-dev/qa/import-${theme}-${width}-${dir}-${eink}.png`,
  });
});

it('lets Enter choose a folder, Space change grouping, and Escape safely stop the active import', async () => {
  await page.viewport(900, 720);
  let finish!: () => void;
  const confirm = vi.fn<React.ComponentProps<typeof ImportFromFolderDialog>['onConfirm']>(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const cancel = vi.fn();
  const pick = vi.fn().mockResolvedValue('/New/Books');
  render(
    <ImportFromFolderDialog
      initialDirectory='/Books'
      onScanDirectory={scan}
      onPickDirectory={pick}
      onCancel={cancel}
      onConfirm={confirm}
    />,
  );
  await screen.findByRole('button', { name: '导入 3 本' });
  // Wait for the shared dialog's initial focus before driving real keyboard input.
  await waitFor(() => expect(document.activeElement?.tagName).toBe('DIALOG'));
  await userEvent.tab();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '关闭' }));
  await userEvent.tab();
  await userEvent.keyboard('{Enter}');
  await waitFor(() => expect(pick).toHaveBeenCalledOnce());
  expect(confirm).not.toHaveBeenCalled();
  await screen.findByTitle('/New/Books');
  await userEvent.tab();
  expect(document.activeElement).toBe(screen.getByRole('checkbox'));
  await userEvent.keyboard(' ');
  await userEvent.tab();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '取消' }));
  await userEvent.tab();
  await userEvent.keyboard('{Enter}');
  expect(confirm).toHaveBeenCalledOnce();
  expect(confirm.mock.calls[0]![0]).toMatchObject({ directory: '/New/Books', flatten: true });
  await act(async () => confirm.mock.calls[0]![2](2, 3));
  await screen.findByText('正在导入 2 / 3 本…');
  await userEvent.keyboard('{Escape}');
  expect(confirm.mock.calls[0]![1].aborted).toBe(true);
  expect(cancel).not.toHaveBeenCalled();
  await screen.findByText('正在停止…');
  await act(async () => finish());
  expect(cancel).toHaveBeenCalledOnce();
});
