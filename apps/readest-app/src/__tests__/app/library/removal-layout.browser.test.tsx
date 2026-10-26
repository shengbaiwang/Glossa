import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import RecentlyDeleted from '@/app/library/components/RecentlyDeleted';
import DeleteConfirmAlert from '@/components/DeleteConfirmAlert';
import ModalPortal from '@/components/ModalPortal';
import { useLibraryStore } from '@/store/libraryStore';
import type { Book } from '@/types/book';
import '@/styles/globals.css';
import '@/styles/glossa.css';

vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {}, appService: null }) }));
const locale = vi.hoisted(() => ({ strings: {} as Record<string, string> }));
beforeAll(async () => {
  locale.strings = await fetch('/locales/zh-CN/translation.json').then((response) =>
    response.json(),
  );
});
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation:
    () =>
    (key: string, values: Record<string, unknown> = {}) =>
      (locale.strings[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
        String(values[name] ?? name),
      ),
}));
afterEach(() => {
  cleanup();
  for (const name of ['data-theme', 'data-eink', 'dir'])
    document.documentElement.removeAttribute(name);
});
const books: Book[] = [
  ['时间的革命', '大卫·兰德斯', 'EPUB'],
  ['城市与文明：一部漫长的社会生活史', '原创验收材料', 'PDF'],
  ['阅读札记', '', 'MD'],
].map(([title, author, format], index) => ({
  hash: `layout-${index}`,
  title: title!,
  author: author!,
  format: format as Book['format'],
  createdAt: 1,
  updatedAt: 1,
  deletedAt: 2,
  removal: {
    version: 1,
    id: `layout-job-${index}`,
    revision: 2,
    requestedAt: 2,
    mode: 'trash',
    local: 'complete',
    cloud: 'none',
  },
}));

for (const variant of [
  { name: 'desktop', width: 1000, theme: 'default-light', eink: false, rtl: false },
  { name: 'mobile-dark', width: 390, theme: 'default-dark', eink: false, rtl: false },
  { name: 'eink-rtl', width: 390, theme: 'default-light', eink: true, rtl: true },
]) {
  test(`deleted books remain readable and directly actionable: ${variant.name}`, async () => {
    await page.viewport(variant.width, 780);
    document.documentElement.setAttribute('data-theme', variant.theme);
    document.documentElement.setAttribute('data-eink', String(variant.eink));
    document.documentElement.setAttribute('dir', variant.rtl ? 'rtl' : 'ltr');
    useLibraryStore.getState().setLibrary(books);
    render(
      <div style={{ height: '100vh', display: 'flex', background: 'var(--glossa-surface)' }}>
        <RecentlyDeleted />
      </div>,
    );
    expect(screen.queryByText('检查旧共享数据')).toBeNull();
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
    for (const row of document.querySelectorAll('.glossa-deleted-row')) {
      for (const button of row.querySelectorAll('button')) {
        expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
        expect(button.getBoundingClientRect().width).toBeGreaterThanOrEqual(44);
      }
    }
    await page.screenshot({
      path: `../../../../../../.glossa-dev/qa/removal-ui-${variant.name}.png`,
    });
    const trigger = screen.getByRole('button', { name: '彻底删除《时间的革命》' });
    await userEvent.click(trigger);
    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByText('时间的革命')).toBeTruthy();
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: '取消' }));
    expect(dialog.getBoundingClientRect().width).toBeLessThanOrEqual(window.innerWidth - 24);
    const details = within(dialog).getByText('删除范围').closest('details')!;
    expect(details.open).toBe(false);
    if (variant.eink) {
      const destructive = within(dialog).getByRole('button', { name: '彻底删除' });
      expect(getComputedStyle(destructive).backgroundColor).toBe('rgb(0, 0, 0)');
      expect(getComputedStyle(destructive).color).toBe('rgb(255, 255, 255)');
    }
    await page.screenshot({
      path: `../../../../../../.glossa-dev/qa/removal-ui-confirm-${variant.name}.png`,
    });
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
}

test('ordinary deletion uses a short neutral confirmation in Chinese', async () => {
  await page.viewport(390, 780);
  document.documentElement.setAttribute('data-theme', 'default-light');
  const confirm = vi.fn();
  render(
    <ModalPortal>
      <DeleteConfirmAlert
        title='删除书籍？'
        books={[books[0]!]}
        message='移入最近删除，书籍与阅读数据可恢复。'
        onCancel={() => {}}
        onConfirm={confirm}
      />
    </ModalPortal>,
  );
  const dialog = screen.getByRole('alertdialog');
  expect(within(dialog).queryByText('已选 1')).toBeNull();
  expect(
    within(dialog).getByRole('button', { name: '删除' }).classList.contains('btn-contrast'),
  ).toBe(true);
  await page.screenshot({
    path: '../../../../../../.glossa-dev/qa/removal-ui-confirm-ordinary.png',
  });
  await userEvent.keyboard('{Tab}{Enter}');
  expect(confirm).toHaveBeenCalledOnce();
});
