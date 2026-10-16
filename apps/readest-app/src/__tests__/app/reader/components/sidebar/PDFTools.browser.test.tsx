import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
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

it('edits the contents inline with keyboard and fits a narrow sidebar in light, dark and RTL/eink views', async () => {
  const doc = { sections: Array.from({ length: 8 }, () => ({})) } as unknown as BookDoc;
  const { container } = render(
    <aside
      style={{ display: 'flex', flexDirection: 'column', width: 320, height: 850 }}
      className='bg-base-100 text-base-content'
    >
      <PDFTools bookKey='original' bookDoc={doc} />
    </aside>,
  );
  const button = await screen.findByRole('button', { name: '修复目录' });
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(button);
  const heading = screen.getByRole('button', { name: /第一章 阅读与观察/ });
  heading.focus();
  await userEvent.keyboard('{F2}');
  const input = screen.getByRole('textbox', { name: state.translations['Chapter title'] });
  expect(document.activeElement).toBe(input);
  await userEvent.clear(input);
  await userEvent.type(input, '第一章 我的阅读目录');
  await userEvent.keyboard('{Enter}');
  expect(screen.getByRole('button', { name: /第一章 我的阅读目录/ })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: state.translations['Undo'] ?? 'Undo' }));
  expect(screen.getByRole('button', { name: /第一章 阅读与观察/ })).toBeTruthy();
  const tools = container.querySelector<HTMLElement>('.glossa-pdf-tools')!;
  const coarse = matchMedia('(pointer: coarse)').matches;
  let previousBackground = '';
  for (const theme of ['default', 'default-dark']) {
    document.documentElement.setAttribute('data-theme', theme);
    const background = getComputedStyle(container.querySelector('aside')!).backgroundColor;
    expect(background).not.toBe(previousBackground);
    previousBackground = background;
    expect(tools.scrollWidth).toBeLessThanOrEqual(tools.clientWidth + 1);
    for (const control of tools.querySelectorAll<HTMLElement>('button, input')) {
      expect(control.getBoundingClientRect().height).toBeGreaterThanOrEqual(coarse ? 44 : 32);
    }
    await page.screenshot({
      element: container,
      path: `/Users/nidao./Documents/ChatGPT/Glossa/.glossa-dev/qa/pdf-tools-${theme}-${coarse ? 'touch' : 'mouse'}.png`,
    });
  }
  document.documentElement.setAttribute('dir', 'rtl');
  document.documentElement.setAttribute('data-eink', 'true');
  expect(tools.scrollWidth).toBeLessThanOrEqual(tools.clientWidth + 1);
  expect(getComputedStyle(tools.querySelector('button')!).borderTopStyle).toBe('solid');
  tools.scrollTop = tools.scrollHeight;
  await page.screenshot({
    element: container,
    path: `/Users/nidao./Documents/ChatGPT/Glossa/.glossa-dev/qa/pdf-tools-actions-${coarse ? 'touch' : 'mouse'}.png`,
  });
});
