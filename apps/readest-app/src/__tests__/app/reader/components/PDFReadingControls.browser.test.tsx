import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { DocumentLoader, type BookDoc } from '@/libs/document';
import type { FoliateView } from '@/types/view';
import type { ViewSettings } from '@/types/book';
import PDFPages from '@/app/reader/components/sidebar/PDFPages';
import DesktopFooterBar from '@/app/reader/components/footerbar/DesktopFooterBar';
import 'foliate-js/view.js';
import '@/styles/globals.css';
import '@/styles/glossa.css';
import '@/styles/glossa-reader.css';
import '@/styles/glossa-desktop.css';
import '@/styles/glossa-reader-navigation.css';
let view: FoliateView;
let book: BookDoc;
let settings = { zoomMode: 'fit-width', zoomLevel: 150 } as ViewSettings;
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, values?: Record<string, unknown>) =>
    key.replace(/{{(\w+)}}/g, (_, name: string) => String(values?.[name] ?? '')),
}));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {} }) }));
vi.mock('@/helpers/settings', () => ({ saveViewSettings: vi.fn(async () => {}) }));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({
    getBookData: () => ({ book: { format: 'PDF' }, isFixedLayout: true, bookDoc: book }),
  }),
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: (select?: (state: unknown) => unknown) => {
    const state = {
      hoveredBookKey: 'original',
      getView: () => view,
      getViewSettings: () => settings,
      setViewSettings: (_key: string, next: ViewSettings) => {
        settings = next;
      },
      getProgress: () => ({
        section: { current: view.renderer.index ?? 0, total: book.sections.length },
      }),
    };
    return select ? select(state) : state;
  },
}));
afterEach(async () => {
  cleanup();
  view?.close();
  view?.remove();
  await book?.destroy?.();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-eink');
  document.documentElement.removeAttribute('dir');
});
it('uses the visible PDF size for fit controls and percentages without overflowing a narrow reading pane', async () => {
  await page.viewport(1200, 820);
  const bytes = await fetch('/src/__tests__/fixtures/data/glossa-reading-sample.pdf').then((r) =>
    r.arrayBuffer(),
  );
  book = (
    await new DocumentLoader(new File([bytes], 'original.pdf', { type: 'application/pdf' })).open()
  ).book;
  view = document.createElement('foliate-view') as FoliateView;
  view.style.cssText = 'display:block;width:100%;height:620px';
  document.body.append(view);
  await view.open(book);
  view.renderer.setAttribute('spread', 'none');
  view.renderer.setAttribute('zoom', 'fit-width');
  view.renderer.setAttribute('scale-factor', 150);
  view.renderer.setAttribute('flow', 'scrolled');
  await view.goTo(1);
  const { container } = render(
    <div
      className='glossa-reader-chrome'
      style={{
        display: 'flex',
        height: 720,
        background: 'var(--glossa-surface)',
        color: 'var(--glossa-ink)',
      }}
    >
      <aside style={{ width: 290, flexShrink: 0 }}>
        <PDFPages bookKey='original' bookDoc={book} />
      </aside>
      <div className='qa-reading-pane' style={{ minWidth: 0, flex: 1 }}>
        <div
          ref={(element) => {
            if (element) element.append(view);
          }}
        />
        <DesktopFooterBar
          bookKey='original'
          gridInsets={{ top: 0, bottom: 0, left: 0, right: 0 }}
          progressValid
          progressFraction={0.5}
          forceMobileLayout={false}
          actionTab=''
          onSetActionTab={vi.fn()}
          navigationHandlers={{
            onPrevPage: vi.fn(),
            onNextPage: vi.fn(),
            onPrevSection: vi.fn(),
            onNextSection: vi.fn(),
            onGoBack: vi.fn(),
            onGoForward: vi.fn(),
            onProgressChange: vi.fn(),
          }}
        />
      </div>
    </div>,
  );
  await waitFor(() =>
    expect(container.querySelectorAll('.glossa-pdf-thumbnail img').length).toBe(4),
  );
  for (const image of container.querySelectorAll<HTMLImageElement>('.glossa-pdf-thumbnail img')) {
    expect(image.getBoundingClientRect().height).toBeLessThanOrEqual(161);
    expect(image.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      image.closest('button')!.getBoundingClientRect().bottom,
    );
  }
  await view.goTo(1);
  await expect.poll(() => view.renderer.index).toBe(1);
  const currentFrame = () =>
    view.renderer.getContents().find((c) => c.index === view.renderer.index)!.doc.defaultView!
      .frameElement!;
  await userEvent.click(screen.getByRole('button', { name: 'Fit Page' }));
  await expect.poll(() => currentFrame().getBoundingClientRect().height).toBeLessThanOrEqual(621);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Fit Page' }).getAttribute('aria-pressed')).toBe(
      'true',
    ),
  );
  expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Go to Page' }).value).toMatch(
    /\/ 4$/,
  );
  await expect.poll(() => view.renderer.index).toBe(1);
  expect(container.textContent).toContain('Printed page ii');
  for (const theme of ['default', 'default-dark']) {
    document.documentElement.setAttribute('data-theme', theme);
    await page.screenshot({
      element: container,
      path: `/Users/nidao./Documents/ChatGPT/Glossa/.glossa-dev/qa/pdf-reading-controls-${theme}.png`,
    });
  }
  await userEvent.click(screen.getByRole('button', { name: 'Fit Width' }));
  await expect
    .poll(() => currentFrame().getBoundingClientRect().width)
    .toBeCloseTo(view.renderer.getBoundingClientRect().width, 0);
  expect(currentFrame().getBoundingClientRect().height).toBeGreaterThan(620);
  await page.getByRole('button', { name: /^Zoom \d+%$/ }).click();
  await userEvent.click(screen.getByRole('menuitem', { name: '100%' }));
  await expect.poll(() => view.renderer.scale).toBe(1);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Zoom 100%' }).textContent).toContain('100%'),
  );
  const pane = container.querySelector<HTMLElement>('.qa-reading-pane')!;
  pane.style.cssText = 'width:320px;flex:none;min-width:0';
  document.documentElement.setAttribute('dir', 'rtl');
  document.documentElement.setAttribute('data-eink', 'true');
  const footer = container.querySelector<HTMLElement>('.glossa-reader-navigation')!;
  await expect.poll(() => footer.scrollWidth).toBeLessThanOrEqual(footer.clientWidth + 1);
  for (const control of footer.querySelectorAll<HTMLElement>('button, input')) {
    if (getComputedStyle(control).display === 'none' || !control.getClientRects().length) continue;
    const box = control.getBoundingClientRect();
    const host = footer.getBoundingClientRect();
    expect(box.top).toBeGreaterThanOrEqual(host.top - 1);
    expect(box.bottom).toBeLessThanOrEqual(host.bottom + 1);
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
  const entry = screen.getByRole<HTMLInputElement>('textbox', { name: 'Go to Page' });
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d')!;
  const luminance = (color: string) => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    const channels = [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3).map((value) => {
      const v = value / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
  };
  let background = '';
  for (let ancestor = entry.parentElement; ancestor; ancestor = ancestor.parentElement) {
    background = getComputedStyle(ancestor).backgroundColor;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, 1, 1);
    if (ctx.getImageData(0, 0, 1, 1).data[3]! > 250) break;
  }
  const foregroundL = luminance(
    getComputedStyle(entry).webkitTextFillColor || getComputedStyle(entry).color,
  );
  const backgroundL = luminance(background);
  expect(
    (Math.max(foregroundL, backgroundL) + 0.05) / (Math.min(foregroundL, backgroundL) + 0.05),
  ).toBeGreaterThanOrEqual(4.5);
  expect(getComputedStyle(entry.parentElement!).direction).toBe('ltr');
  if (matchMedia('(pointer: coarse)').matches) {
    const target = entry.closest('label');
    expect(target).toBeTruthy();
    expect(target!.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    await userEvent.click(target!.querySelector('.glossa-pdf-printed-page')!);
    expect(document.activeElement).toBe(entry);
    await userEvent.keyboard('{Escape}');
  }
  await page.screenshot({
    element: footer,
    path: '/Users/nidao./Documents/ChatGPT/Glossa/.glossa-dev/qa/pdf-reading-controls-narrow-eink.png',
  });
});
