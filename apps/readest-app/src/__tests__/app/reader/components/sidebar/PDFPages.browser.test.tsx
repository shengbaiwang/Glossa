import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import PDFPages from '@/app/reader/components/sidebar/PDFPages';
import type { BookDoc } from '@/libs/document';
import '@/styles/globals.css';
import '@/styles/glossa.css';
const state = vi.hoisted(() => ({ goTo: vi.fn(), save: vi.fn(), copied: vi.fn() }));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, values?: Record<string, unknown>) =>
    key.replace(/{{(\w+)}}/g, (_, name: string) => String(values?.[name] ?? '')),
}));
vi.mock('@/utils/clipboard', () => ({
  writeTextToClipboard: async (text: string) => {
    state.copied(text);
    return true;
  },
}));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { saveFile: state.save } }),
}));
const events = new EventTarget();
const view = {
  renderer: { index: 3 },
  goTo: state.goTo,
  addEventListener: events.addEventListener.bind(events),
  removeEventListener: events.removeEventListener.bind(events),
};
vi.mock('@/store/readerStore', () => ({
  useReaderStore: (select: (s: unknown) => unknown) => select({ getView: () => view }),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  view.renderer.index = 3;
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-eink');
  document.documentElement.removeAttribute('dir');
});
it('browses virtual pages, copies a bounded page range, navigates and closes a keyboard-accessible overview in narrow themed layouts', async () => {
  const canvas = document.createElement('canvas');
  canvas.width = 100;
  canvas.height = 130;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, 100, 130);
  ctx.fillStyle = '#333';
  ctx.font = '12px serif';
  ctx.fillText('Original page', 8, 25);
  const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!)));
  const image = vi.fn(async () => blob);
  const book = {
    sections: Array.from({ length: 60 }, () => ({})),
    pageList: Array.from({ length: 60 }, (_, i) => ({ label: String(i + 1) })),
    getPDFImage: image,
    getPDFText: async (i: number) => `Page ${i + 1} original text`,
  } as unknown as BookDoc;
  const { container } = render(
    <aside style={{ width: 320, height: 800, overflow: 'auto' }}>
      <PDFPages bookKey='original' bookDoc={book} />
    </aside>,
  );
  await waitFor(() => expect(container.querySelectorAll('img').length).toBeGreaterThan(4));
  expect(image.mock.calls.length).toBeLessThan(40);
  await userEvent.click(screen.getByRole('button', { name: 'Page actions' }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Select pages' }));
  if (matchMedia('(pointer: coarse)').matches) {
    expect(
      screen.getByRole('checkbox', { name: 'Select page 3' }).getBoundingClientRect().width,
    ).toBeGreaterThanOrEqual(44);
    expect(
      screen.getByRole('button', { name: 'Page actions' }).getBoundingClientRect().height,
    ).toBeGreaterThanOrEqual(44);
  }
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select page 3' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select page 4' }));
  fireEvent.click(screen.getByRole('button', { name: 'Copy selected pages' }));
  await waitFor(() =>
    expect(state.copied).toHaveBeenCalledWith('Page 3 original text\n\nPage 4 original text'),
  );
  fireEvent.click(screen.getByRole('button', { name: /^Page 3$/ }));
  expect(state.goTo).toHaveBeenCalledWith(2);
  for (const theme of ['default', 'default-dark']) {
    document.documentElement.setAttribute('data-theme', theme);
    expect(container.querySelector('aside')!.scrollWidth).toBeLessThanOrEqual(320);
    await page.screenshot({
      element: container,
      path: `/Users/nidao./Documents/ChatGPT/Glossa/.glossa-dev/qa/pdf-pages-${theme}.png`,
    });
  }
  await page.viewport(1200, 900);
  fireEvent.click(screen.getByRole('button', { name: 'Page overview' }));
  const dialog = screen.getByRole('dialog');
  expect(
    dialog.getBoundingClientRect().width,
    JSON.stringify({
      viewport: innerWidth,
      width: getComputedStyle(dialog).width,
      max: getComputedStyle(dialog).maxWidth,
      left: getComputedStyle(dialog).left,
      right: getComputedStyle(dialog).right,
      transform: getComputedStyle(dialog).transform,
    }),
  ).toBeGreaterThan(innerWidth - 60);
  await waitFor(() => expect(dialog.querySelectorAll('img').length).toBeGreaterThan(4));
  expect(dialog.getBoundingClientRect().width).toBeGreaterThan(1000);
  await page.viewport(390, 850);
  expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth + 1);
  expect(document.activeElement?.closest('[role="dialog"]')).toBeTruthy();
  document.documentElement.setAttribute('dir', 'rtl');
  document.documentElement.setAttribute('data-eink', 'true');
  expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth + 1);
  await waitFor(() => expect(getComputedStyle(dialog).boxShadow).toBe('none'));
  await page.screenshot({
    element: dialog,
    path: '/Users/nidao./Documents/ChatGPT/Glossa/.glossa-dev/qa/pdf-page-overview.png',
  });
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).toBeNull();
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Page overview' })),
  );
});

it('follows the reading page without a second page-entry control or permanent selection boxes', async () => {
  view.renderer.index = 46;
  const book = {
    sections: Array.from({ length: 423 }, () => ({})),
    pageList: Array.from({ length: 423 }, (_, i) => ({ label: i === 46 ? '3' : String(i + 1) })),
    getPDFImage: vi.fn(async () => new Blob(['original'], { type: 'image/png' })),
  } as unknown as BookDoc;
  const { container } = render(
    <div style={{ height: 700, width: 320 }}>
      <PDFPages bookKey='original' bookDoc={book} />
    </div>,
  );
  await waitFor(() =>
    expect(container.querySelector('[aria-current="page"]')?.getAttribute('aria-label')).toContain(
      '47',
    ),
  );
  expect(screen.queryByRole('spinbutton')).toBeNull();
  expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  expect(screen.getByText('47 / 423')).toBeTruthy();
  expect(screen.getAllByText('Printed page 3').length).toBeGreaterThan(0);
  view.renderer.index = 112;
  events.dispatchEvent(new Event('relocate'));
  await waitFor(() =>
    expect(container.querySelector('[aria-current="page"]')?.getAttribute('aria-label')).toBe(
      'Page 113',
    ),
  );
  expect(screen.getByText('113 / 423')).toBeTruthy();
  expect(book.getPDFImage).toHaveBeenCalled();
  expect(container.querySelectorAll('img').length).toBeLessThan(60);
  expect(state.goTo).not.toHaveBeenCalled();
});

it('keeps other thumbnails usable after a failed page and retries in place', async () => {
  view.renderer.index = 0;
  const canvas = document.createElement('canvas');
  canvas.width = 80;
  canvas.height = 100;
  const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!)));
  let failed = false;
  const image = vi.fn(async (index: number) => {
    if (index === 1 && !failed) {
      failed = true;
      throw new Error('render failed');
    }
    return blob;
  });
  const book = {
    sections: Array.from({ length: 4 }, () => ({})),
    getPDFImage: image,
  } as unknown as BookDoc;
  const { container } = render(
    <aside style={{ width: 320, height: 800 }}>
      <PDFPages bookKey='retry' bookDoc={book} />
    </aside>,
  );
  await waitFor(() =>
    expect(screen.getByRole('alert').textContent).toContain('Could not render PDF pages'),
  );
  await waitFor(() => expect(container.querySelectorAll('img')).toHaveLength(3));
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(container.querySelectorAll('img')).toHaveLength(4));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(image.mock.calls.filter(([index]) => index === 0)).toHaveLength(1);
});

it('moves thumbnail focus through virtual pages with arrows and Home/End before Enter navigates', async () => {
  view.renderer.index = 0;
  const book = {
    sections: Array.from({ length: 423 }, () => ({})),
    getPDFImage: async () => new Blob(),
  } as unknown as BookDoc;
  render(
    <aside style={{ width: 320, height: 700 }}>
      <PDFPages bookKey='keyboard' bookDoc={book} />
    </aside>,
  );
  const first = await screen.findByRole('button', { name: 'Page 1' });
  first.focus();
  await userEvent.keyboard('{ArrowRight}');
  await waitFor(() => expect(document.activeElement?.getAttribute('aria-label')).toBe('Page 2'));
  await userEvent.keyboard('{End}');
  await waitFor(() => expect(document.activeElement?.getAttribute('aria-label')).toBe('Page 423'));
  expect(state.goTo).not.toHaveBeenCalled();
  await userEvent.keyboard('{Enter}');
  expect(state.goTo).toHaveBeenCalledWith(422);
  document.documentElement.setAttribute('dir', 'rtl');
  await userEvent.keyboard('{ArrowRight}');
  await waitFor(() => expect(document.activeElement?.getAttribute('aria-label')).toBe('Page 422'));
  await userEvent.keyboard('{Home}');
  await waitFor(() => expect(document.activeElement?.getAttribute('aria-label')).toBe('Page 1'));
});
