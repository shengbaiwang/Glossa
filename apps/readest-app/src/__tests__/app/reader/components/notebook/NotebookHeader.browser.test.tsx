import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { MessageCircle, GitBranch, Highlight } from '@/components/GlossaIcons';
import ReaderPaneTabs from '@/app/reader/components/ReaderPaneTabs';
import NotebookHeader from '@/app/reader/components/notebook/Header';
import '@/styles/globals.css';
import '@/styles/glossa.css';
import '@/styles/glossa-reader.css';
import '@/styles/glossa-desktop.css';
import '@/styles/glossa-reader-sidebar.css';

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/hooks/useResponsiveSize', () => ({ useResponsiveSize: (size: number) => size }));

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('dir');
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-eink');
});

it('keeps destination icons and the close action aligned in narrow, RTL and e-ink layouts', async () => {
  await page.viewport(1000, 600);
  document.documentElement.setAttribute('data-theme', 'default-light');
  render(
    <div
      data-testid='pane'
      className='glossa-reader-notebook'
      style={{ width: 320, position: 'absolute', insetInlineEnd: 0, top: 0 }}
    >
      <NotebookHeader handleClose={vi.fn()}>
        <ReaderPaneTabs
          label='Notebook'
          activeTab='mindmap'
          onTabChange={vi.fn()}
          tabs={[
            { id: 'conversation', label: 'Conversation', Icon: MessageCircle },
            { id: 'mindmap', label: 'Mind map', Icon: GitBranch },
            { id: 'notes', label: 'Notes', Icon: Highlight },
          ]}
        />
      </NotebookHeader>
    </div>,
  );
  const pane = screen.getByTestId('pane');
  const tabs = screen.getAllByRole('tab');
  const close = screen.getByRole('button', { name: 'Close' });
  // The pane header holds only the destinations and their close action.
  expect(screen.queryByRole('button', { name: 'View Options' })).toBeNull();
  for (const width of [240, 280, 320, 420]) {
    pane.style.width = `${width}px`;
    expect(pane.scrollWidth).toBeLessThanOrEqual(width);
    const header = pane.querySelector('.notebook-header')!;
    expect(header.getBoundingClientRect().height).toBe(44);
    expect(close.getBoundingClientRect().right).toBeLessThanOrEqual(
      pane.getBoundingClientRect().right,
    );
    expect(tabs[2]!.getBoundingClientRect().right).toBeLessThan(close.getBoundingClientRect().left);
    if (width >= 320) {
      for (const tab of tabs) {
        expect(tab.textContent).toBe('');
        expect(getComputedStyle(tab.querySelector('svg')!).display).not.toBe('none');
        expect(tab.getBoundingClientRect().width).toBe(32);
      }
    }
  }
  const active = screen.getByRole('tab', { name: 'Mind map' });
  expect(getComputedStyle(active, '::before').backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
  expect(getComputedStyle(active, '::after').content).toBe('none');
  active.focus();
  expect(getComputedStyle(active).outlineStyle).toBe('solid');

  document.documentElement.dir = 'rtl';
  pane.style.width = '280px';
  expect(close.getBoundingClientRect().right).toBeLessThan(tabs[2]!.getBoundingClientRect().left);
  document.documentElement.setAttribute('data-theme', 'default-dark');
  expect(pane.scrollWidth).toBeLessThanOrEqual(280);
  document.documentElement.setAttribute('data-eink', 'true');
  expect(getComputedStyle(active, '::before').borderTopColor).not.toBe('rgba(0, 0, 0, 0)');
});
