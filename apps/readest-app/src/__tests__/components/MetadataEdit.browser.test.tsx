import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import BookDetailModal from '@/components/metadata/BookDetailModal';
import type { Book } from '@/types/book';
import '@/styles/globals.css';
import '@/styles/glossa.css';

const state = vi.hoisted(() => ({
  translations: {} as Record<string, string>,
  close: vi.fn(),
  save: vi.fn(),
}));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => state.translations[key] ?? key,
}));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({
    envConfig: { getAppService: async () => ({ getBookFileSize: async () => 1024 }) },
    appService: {},
  }),
}));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({ safeAreaInsets: { top: 0, bottom: 0, left: 0, right: 0 } }),
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({ settings: { metadataOthersCollapsed: true } }),
}));
vi.mock('@/hooks/useFileSelector', () => ({
  useFileSelector: () => ({ selectFiles: async () => ({ files: [] }) }),
}));
vi.mock('@/libs/metadata', () => ({ searchMetadata: async () => [] }));
vi.mock('@/components/BookCover', () => ({
  default: ({ book }: { book: Book }) => (
    <div
      className='flex h-full w-full flex-col items-center justify-center gap-5 p-3 text-center'
      data-cover={book.metadata?.coverImageUrl}
      style={{ background: '#64736b', color: '#fffaf0', fontFamily: 'serif' }}
    >
      <span style={{ fontSize: 20, writingMode: 'vertical-rl', letterSpacing: 4 }}>雨后书简</span>
      <span style={{ fontSize: 9 }}>林青 · 阅读随笔</span>
    </div>
  ),
}));

const book: Book = {
  hash: 'original-metadata-layout-fixture',
  title: '雨后书简：关于散步、阅读与日常生活的随笔',
  author: '林青',
  format: 'EPUB',
  createdAt: 1,
  updatedAt: 1,
  metadata: {
    title: '雨后书简：关于散步、阅读与日常生活的随笔',
    subtitle: '在纸页间记录四季',
    author: '林青',
    series: '城市与阅读',
    seriesIndex: 2,
    publisher: '纸页出版社',
    published: '2026-10',
    language: 'zh',
    subject: ['随笔', '阅读'],
    description:
      '一组关于散步与阅读的原创随笔。从日常生活中拾起细小的片段，在纸页之间留下四季的声音。',
    coverImageUrl: 'original-cover',
  },
  tags: ['待读'],
};

beforeAll(async () => {
  state.translations = await (await fetch('/locales/zh-CN/translation.json')).json();
});
afterEach(() => {
  cleanup();
  state.close.mockClear();
  state.save.mockClear();
  document.documentElement.classList.remove('theme-changing');
  for (const attr of ['dir', 'data-theme', 'data-eink', 'data-page'])
    document.documentElement.removeAttribute(attr);
});

async function openEditor() {
  render(
    <main className='bg-base-100 text-base-content h-screen'>
      <BookDetailModal
        book={book}
        isOpen
        onClose={state.close}
        handleBookMetadataUpdate={state.save}
      />
    </main>,
  );
  await screen.findByTitle('编辑元数据');
  fireEvent.click(screen.getByTitle('编辑元数据'));
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole('dialog', { name: '编辑元数据' })),
  );
  return screen.findByRole('textbox', { name: '书名' });
}

it('keeps themed fields and fixed actions in light, dark, narrow, short RTL and e-ink windows', async () => {
  for (const [name, width, height, theme, dir, eink] of [
    ['light', 1100, 900, 'default-light', 'ltr', false],
    ['dark', 1100, 900, 'default-dark', 'ltr', false],
    ['narrow', 320, 700, 'default-dark', 'ltr', false],
    ['short-rtl', 760, 480, 'default-light', 'rtl', false],
    ['eink', 390, 760, 'default-light', 'ltr', true],
  ] as const) {
    await page.viewport(width, height);
    document.documentElement.classList.add('theme-changing');
    document.documentElement.setAttribute('data-page', 'library');
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.setAttribute('dir', dir);
    document.documentElement.setAttribute('data-eink', String(eink));
    const title = await openEditor();
    const modal = title.closest('.modal-box')!;
    const scroller = modal.querySelector('.glossa-metadata-scroll')!;
    const save = screen.getByRole('button', { name: '保存' });
    await waitFor(() => expect(modal.getAnimations().length).toBe(0));
    await waitFor(() =>
      expect(
        [...modal.querySelectorAll('button')].some((button) => button.getAnimations().length > 0),
      ).toBe(false),
    );
    title.focus();
    expect(getComputedStyle(title).outlineStyle).toBe('solid');
    expect(getComputedStyle(title).color).toBe(getComputedStyle(modal).color);
    expect(getComputedStyle(title).backgroundColor).toBe(getComputedStyle(modal).backgroundColor);
    const before = save.getBoundingClientRect();
    expect(before.bottom).toBeLessThanOrEqual(height);
    expect(before.top).toBeGreaterThan(0);
    expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight);
    expect(scroller.scrollWidth).toBeLessThanOrEqual(scroller.clientWidth);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
    for (const element of modal.querySelectorAll('input, textarea, button')) {
      const bounds = element.getBoundingClientRect();
      if (bounds.width === 0) continue;
      expect(bounds.left).toBeGreaterThanOrEqual(0);
      expect(bounds.right).toBeLessThanOrEqual(width);
      if (matchMedia('(pointer: coarse)').matches) {
        expect(bounds.height, element.outerHTML).toBeGreaterThanOrEqual(44);
      }
    }
    title.blur();
    const touch = matchMedia('(pointer: coarse)').matches;
    await page.screenshot({
      path: `../../../../../.glossa-dev/qa/metadata-${touch ? 'touch' : 'pointer'}-${name}.png`,
    });
    scroller.scrollTop = scroller.scrollHeight;
    expect(save.getBoundingClientRect().top).toBe(before.top);
    const description = screen.getByRole('textbox', { name: '简介' });
    description.focus();
    expect(description.getBoundingClientRect().bottom).toBeLessThanOrEqual(before.top);
    expect(save.getBoundingClientRect().top).toBe(before.top);
    if (eink) {
      expect(getComputedStyle(modal).boxShadow).toBe('none');
      expect(getComputedStyle(title).borderTopColor).toBe(getComputedStyle(title).color);
    }
    cleanup();
  }
});

it('supports keyboard locking, validation, cover reset, cancel, save and Escape', async () => {
  await page.viewport(1100, 900);
  document.documentElement.setAttribute('data-theme', 'default-dark');
  const title = (await openEditor()) as HTMLInputElement;
  title.focus();
  await userEvent.tab();
  const lock = screen.getByRole('button', { name: '锁定字段: 书名' });
  expect(document.activeElement).toBe(lock);
  expect(getComputedStyle(lock).opacity).toBe('1');
  await userEvent.keyboard('{Enter}');
  expect(title.disabled).toBe(true);
  expect(getComputedStyle(title).opacity).toBe('1');
  await userEvent.keyboard('{Enter}');
  expect(title.disabled).toBe(false);
  fireEvent.change(screen.getByRole('textbox', { name: 'ISBN' }), {
    target: { value: 'bad-isbn' },
  });
  expect((screen.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole('alert').textContent).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '移除封面图片' }));
  fireEvent.click(screen.getByRole('button', { name: '重置' }));
  expect(document.querySelector('[data-cover="original-cover"]')).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
  fireEvent.change(title, { target: { value: '临时修改' } });
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(state.save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTitle('编辑元数据'));
  const reopened = await screen.findByRole('textbox', { name: '书名' });
  expect((reopened as HTMLInputElement).value).toBe(book.title);
  fireEvent.change(reopened, { target: { value: '雨后书简' } });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  expect(state.save).toHaveBeenCalledWith(book, expect.objectContaining({ title: '雨后书简' }), [
    '待读',
  ]);
  await userEvent.keyboard('{Escape}');
  expect(state.close).toHaveBeenCalled();
});
