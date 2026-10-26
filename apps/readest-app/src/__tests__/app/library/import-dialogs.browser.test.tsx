import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import FileImportDialog from '@/app/library/components/FileImportDialog';
import ImportFromFolderDialog from '@/app/library/components/ImportFromFolderDialog';
import ImportFromUrlDialog from '@/app/library/components/ImportFromUrlDialog';
import '@/styles/globals.css';
import '@/styles/glossa.css';
import '@/styles/glossa-library.css';

const zh: Record<string, string> = await (await fetch('/locales/zh-CN/translation.json')).json();
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, values?: Record<string, string | number>) =>
    (zh[key] ?? key).replace(/{{(\w+)}}/g, (_match, name) => String(values?.[name] ?? '')),
}));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: {} }) }));
vi.mock('@/utils/rtl', () => ({
  getDirFromUILanguage: () => document.documentElement.dir || 'ltr',
}));
afterEach(() => {
  cleanup();
  for (const key of ['data-theme', 'data-eink', 'dir'])
    document.documentElement.removeAttribute(key);
});
const fixtures = [
  { theme: 'default-light', width: 900, dir: 'ltr', eink: false },
  { theme: 'default-dark', width: 900, dir: 'ltr', eink: false },
  { theme: 'default-light', width: 390, dir: 'ltr', eink: false },
  { theme: 'default-dark', width: 390, dir: 'rtl', eink: true },
];
it.each(
  fixtures,
)('uses the same compact progress window for all three imports in $theme/$width/$dir', async (fixture) => {
  await page.viewport(fixture.width, 720);
  document.documentElement.setAttribute('data-theme', fixture.theme);
  document.documentElement.dir = fixture.dir;
  document.documentElement.setAttribute('data-eink', String(fixture.eink));
  const heights: number[] = [];
  for (const type of ['files', 'folder', 'web']) {
    let finish!: () => void;
    let signal!: AbortSignal;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const cancel = vi.fn();
    const view = render(
      type === 'files' ? (
        <FileImportDialog state={{ completed: 2, total: 5 }} onCancel={cancel} onRetry={vi.fn()} />
      ) : type === 'folder' ? (
        <ImportFromFolderDialog
          initialDirectory='/原创资料/本周阅读'
          onPickDirectory={vi.fn()}
          onScanDirectory={async () => [{ path: 'Article.epub', size: 20 }]}
          onCancel={cancel}
          onConfirm={async (_result, active) => {
            signal = active;
            await pending;
          }}
        />
      ) : (
        <ImportFromUrlDialog
          isOpen
          onClose={cancel}
          onSubmit={async (_url, active) => {
            signal = active;
            await pending;
          }}
        />
      ),
    );
    if (type === 'folder')
      await userEvent.click(await screen.findByRole('button', { name: '导入 1 本' }));
    if (type === 'web') {
      await userEvent.fill(
        screen.getByRole('textbox'),
        'https://example.com/an-original-article-with-a-long-address',
      );
      await userEvent.click(screen.getByRole('button', { name: '导入' }));
    }
    await screen.findByRole('progressbar');
    const surface = document.querySelector('.glossa-import-dialog')!;
    const rect = surface.getBoundingClientRect();
    expect(rect.width).toBeLessThanOrEqual(Math.min(fixture.width, 480));
    expect(rect.height).toBeLessThan(360);
    expect(rect.left).toBeGreaterThanOrEqual(0);
    expect(rect.right).toBeLessThanOrEqual(fixture.width);
    expect(surface.scrollWidth).toBeLessThanOrEqual(surface.clientWidth);
    heights.push(rect.height);
    const stop = screen.getByRole('button', { name: '取消' });
    expect(stop.getBoundingClientRect().height).toBeGreaterThanOrEqual(
      matchMedia('(pointer: coarse)').matches ? 44 : 36,
    );
    const animation = getComputedStyle(
      surface.querySelector('.glossa-import-spinner')!,
    ).animationName;
    expect(animation).toBe(
      fixture.eink || matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'none'
        : 'glossa-import-spin',
    );
    const progress = screen.getByRole('progressbar');
    if (type === 'web') expect(progress.hasAttribute('aria-valuenow')).toBe(false);
    else expect(progress.getAttribute('aria-valuenow')).toBe(type === 'files' ? '40' : '0');
    await page.screenshot({
      path: `../../../../../../.glossa-dev/qa/import-unified-${type}-${fixture.theme}-${fixture.width}-${fixture.dir}.png`,
    });
    if (type !== 'files') {
      await userEvent.click(stop);
      expect(signal.aborted).toBe(true);
      expect(cancel).not.toHaveBeenCalled();
      await screen.findByText('正在停止…');
      await act(async () => finish());
      await waitFor(() => expect(cancel).toHaveBeenCalledOnce());
    }
    view.unmount();
  }
  expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(24);
});
