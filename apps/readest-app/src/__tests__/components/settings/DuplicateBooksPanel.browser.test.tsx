import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import DuplicateBooksPanel from '@/components/settings/DuplicateBooksPanel';
import { useLibraryStore } from '@/store/libraryStore';
import { getConfigFilename, getLocalBookFilename } from '@/utils/book';
import type { Book } from '@/types/book';
import '@/styles/globals.css';
import '@/styles/glossa.css';

const f = vi.hoisted(() => ({
  files: new Map<string, File>(),
  read: vi.fn(),
  write: vi.fn(),
  open: vi.fn(),
  failSave: false,
}));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({
    appService: {
      resolveFilePath: async () => '/duplicate-browser-fixture',
      exists: async (path: string) => f.files.has(path),
      openFile: f.open,
      readFile: f.read,
      writeFile: f.write,
      readDirectory: async () => [],
    },
  }),
}));
const zh: Record<string, string> = await (await fetch('/locales/zh-CN/translation.json')).json();
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, values?: Record<string, unknown>) =>
    (zh[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values?.[name] ?? name)),
}));

beforeEach(() => {
  f.files.clear();
  f.failSave = false;
  f.open.mockReset().mockImplementation(async (path: string) => {
    const file = f.files.get(path);
    if (!file) throw new Error('Unavailable fixture');
    return file;
  });
  f.read.mockReset().mockImplementation(async (path: string) => (await f.open(path)).text());
  f.write.mockReset().mockImplementation(async (path: string, _base: string, value: string) => {
    if (f.failSave && path === 'library.json') throw new Error('Disk full');
    f.files.set(path, new File([value], path));
  });
  const books: Book[] = ['one', 'two'].map((hash, index) => ({
    hash,
    title: `个人书名 ${index + 1}`,
    sourceTitle: `原始书名 ${index + 1}`,
    author: '作者',
    format: 'EPUB',
    groupName: `分组 ${index + 1}`,
    createdAt: 1,
    updatedAt: 1,
    progress: [index * 40, 100],
    coverImageUrl: `blob:cover-${hash}`,
  }));
  f.files.set(
    'library.json',
    new File(
      [JSON.stringify(books.map(({ coverImageUrl: _cover, ...book }) => book))],
      'library.json',
    ),
  );
  for (const book of books) {
    f.files.set(getLocalBookFilename(book), new File(['original fixture content'], 'fixture.epub'));
    f.files.set(
      getConfigFilename(book),
      new File(
        [JSON.stringify({ booknotes: [{ id: 'same-id', note: `我的批注 ${book.hash}` }] })],
        'config.json',
      ),
    );
  }
  useLibraryStore.getState().setLibrary(books);
});
afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-eink');
});

it.each([
  { width: 760, theme: 'default-light', eink: false },
  { width: 390, theme: 'default-dark', eink: true },
])('reviews actual local files explicitly, selects with keyboard and undoes after reopening at $width', async ({
  width,
  theme,
  eink,
}) => {
  await page.viewport(width, 840);
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.setAttribute('data-eink', String(eink));
  const show = () =>
    render(
      <main className='glossa-settings bg-base-200 text-base-content p-6'>
        <DuplicateBooksPanel onBack={vi.fn()} />
      </main>,
    );
  let view = show();
  expect(f.open).not.toHaveBeenCalled();
  expect(f.write).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: '核验本机文件' }));
  const choices = await screen.findAllByRole('radio');
  expect(f.write).not.toHaveBeenCalled();
  expect(screen.getByText('我的批注 one')).toBeTruthy();
  expect(screen.getByText('我的批注 two')).toBeTruthy();
  expect((screen.getByRole('button', { name: '保留所选记录' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  choices[0]!.focus();
  await userEvent.keyboard('{ArrowRight}');
  expect((choices[1] as HTMLInputElement).checked).toBe(true);
  await userEvent.click(screen.getByRole('button', { name: '保留所选记录' }));
  await waitFor(() =>
    expect(useLibraryStore.getState().visibleLibrary.map((book) => book.hash)).toEqual(['two']),
  );
  expect(
    useLibraryStore
      .getState()
      .library.every((book) => book.coverImageUrl?.startsWith('blob:cover-')),
  ).toBe(true);
  expect(await f.files.get('one/config.json')!.text()).toContain('我的批注 one');
  view.unmount();
  view = show();
  await userEvent.click(screen.getByRole('button', { name: '撤销上次整理' }));
  await waitFor(() => expect(useLibraryStore.getState().visibleLibrary).toHaveLength(2));
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  await userEvent.click(screen.getByRole('button', { name: '核验本机文件' }));
  await screen.findAllByRole('radio');
  for (const label of view.container.querySelectorAll('label'))
    expect(label.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: `../../../../../../.glossa-dev/qa/duplicate-review-${width}.png` });
});

it('retains the preview and explicit choice after a failed save, then retries safely', async () => {
  render(<DuplicateBooksPanel onBack={vi.fn()} />);
  await userEvent.click(screen.getByRole('button', { name: '核验本机文件' }));
  const [choice] = await screen.findAllByRole('radio');
  await userEvent.click(choice!);
  f.failSave = true;
  await userEvent.click(screen.getByRole('button', { name: '保留所选记录' }));
  await screen.findByText('书库已有变化或保存失败，请重新核验后重试。');
  expect(useLibraryStore.getState().visibleLibrary).toHaveLength(2);
  expect((choice as HTMLInputElement).checked).toBe(true);
  f.failSave = false;
  await userEvent.click(screen.getByRole('button', { name: '保留所选记录' }));
  await waitFor(() => expect(useLibraryStore.getState().visibleLibrary).toHaveLength(1));
});

it('cancels an active file check, refuses late results and allows a fresh scan', async () => {
  const open = f.open.getMockImplementation()!;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  f.open.mockImplementation(async (path: string) => {
    if (path.endsWith('.epub')) {
      entered();
      await gate;
    }
    return open(path);
  });
  render(<DuplicateBooksPanel onBack={vi.fn()} />);
  await userEvent.click(screen.getByRole('button', { name: '核验本机文件' }));
  await started;
  await userEvent.click(screen.getByRole('button', { name: '取消' }));
  release();
  await screen.findByText('已取消');
  expect(screen.queryAllByRole('radio')).toHaveLength(0);
  expect(f.write).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: '核验本机文件' }));
  await screen.findAllByRole('radio');
});
