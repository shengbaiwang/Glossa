import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import PDFTools from '@/app/reader/components/sidebar/PDFTools';
import type { BookDoc } from '@/libs/document';
import '@/styles/globals.css';
import '@/styles/glossa.css';

const state = vi.hoisted(() => ({
  translations: {} as Record<string, string>,
  appService: { resolveNativeBookFilePath: async () => '/original.pdf' },
  cache: {
    id: 'a'.repeat(32),
    pages: [],
    revision: 0,
    outline: [
      { title: '第一章 阅读与观察', pageIndex: 1, level: 0 },
      { title: '1.1 从文字返回原来的页面，保留阅读笔记和个人修改', pageIndex: 2, level: 1 },
      { title: '第二章 来源核对', pageIndex: 3, level: 0 },
    ],
  },
}));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => state.translations[key] ?? key,
}));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({
    envConfig: {},
    appService: state.appService,
  }),
}));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: { getState: () => ({ getBookData: () => ({ book: {} }) }) },
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: { getState: () => ({ getView: () => ({ goTo: async () => {} }) }) },
}));
vi.mock('@/services/pdfEnhancement', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/pdfEnhancement')>()),
  openPDFCache: async () => state.cache,
  getPDFOCRStatus: async () => null,
}));
beforeAll(async () => {
  state.translations = await (await fetch('/locales/zh-CN/translation.json')).json();
});
afterEach(() => {
  cleanup();
  for (const name of ['dir', 'data-theme', 'data-eink'])
    document.documentElement.removeAttribute(name);
});

it('keeps optional PDF actions in a compact menu without a manual contents workspace', async () => {
  const doc = { sections: Array.from({ length: 8 }, () => ({})) } as unknown as BookDoc;
  const { container } = render(
    <aside style={{ width: 320 }} className='bg-base-100 text-base-content'>
      <ul className='menu glossa-reader-menu'>
        <PDFTools bookKey='original' bookDoc={doc} />
      </ul>
    </aside>,
  );
  expect(screen.queryByRole('button', { name: '修复目录' })).toBeNull();
  expect(screen.queryByRole('spinbutton')).toBeNull();
  expect(
    screen.getByRole('menuitem', { name: state.translations['Export reading copy'] }),
  ).toBeTruthy();
  const menu = container.querySelector<HTMLElement>('ul')!;
  for (const theme of ['default', 'default-dark']) {
    document.documentElement.setAttribute('data-theme', theme);
    expect(menu.scrollWidth).toBeLessThanOrEqual(menu.clientWidth + 1);
    await page.screenshot({
      element: container,
      path: `/Users/nidao./Documents/ChatGPT/Glossa/.glossa-dev/qa/pdf-menu-${theme}.png`,
    });
  }
  document.documentElement.setAttribute('dir', 'rtl');
  document.documentElement.setAttribute('data-eink', 'true');
  expect(menu.scrollWidth).toBeLessThanOrEqual(menu.clientWidth + 1);
});
