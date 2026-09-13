import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import NotebookHeader from '@/app/reader/components/notebook/Header';
import { DropdownProvider } from '@/context/DropdownContext';
import '@/styles/globals.css';
import '@/styles/glossa.css';
import '@/styles/glossa-reader.css';
import '@/styles/glossa-desktop.css';
import '@/styles/glossa-reader-sidebar.css';

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/hooks/useResponsiveSize', () => ({ useResponsiveSize: (size: number) => size }));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: { isMobile: false } }) }));
vi.mock('@/store/deviceStore', () => ({ useDeviceControlStore: () => ({}) }));

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('dir');
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-eink');
});

it('keeps destination labels and pane actions aligned in narrow, RTL and e-ink layouts', async () => {
  await page.viewport(1000, 600);
  document.documentElement.setAttribute('data-theme', 'default-light');
  render(
    <DropdownProvider>
      <div
        data-testid='pane'
        className='glossa-reader-notebook'
        style={{ width: 320, position: 'absolute', insetInlineEnd: 0, top: 0 }}
      >
        <NotebookHeader isPinned={false} handleClose={vi.fn()} handleTogglePin={vi.fn()}>
          <div
            className='glossa-reader-tabs glossa-notebook-tabs'
            role='tablist'
            aria-label='Notebook'
          >
            {['Conversation', 'Mind map', 'Excerpts'].map((label) => (
              <button
                key={label}
                type='button'
                role='tab'
                aria-label={label}
                aria-selected={label === 'Mind map'}
                className='glossa-reader-tab min-w-0 text-xs font-medium'
              >
                <span className='truncate'>{label}</span>
              </button>
            ))}
          </div>
        </NotebookHeader>
      </div>
    </DropdownProvider>,
  );
  const pane = screen.getByTestId('pane');
  const tabs = screen.getAllByRole('tab');
  const close = screen.getByRole('button', { name: 'Close' });
  const options = screen.getByRole('button', { name: 'View Options' });
  for (const width of [240, 280, 320, 420]) {
    pane.style.width = `${width}px`;
    expect(pane.scrollWidth).toBeLessThanOrEqual(width);
    const header = pane.querySelector('.notebook-header')!;
    expect(header.getBoundingClientRect().height).toBe(48);
    expect(close.getBoundingClientRect().right).toBeLessThanOrEqual(
      pane.getBoundingClientRect().right,
    );
    expect(tabs[2]!.getBoundingClientRect().right).toBeLessThan(
      options.getBoundingClientRect().left,
    );
    if (width >= 320) {
      for (const tab of tabs) {
        const label = tab.querySelector('span')!;
        expect(label.scrollWidth).toBeLessThanOrEqual(label.clientWidth);
      }
    }
  }
  const active = screen.getByRole('tab', { name: 'Mind map' });
  expect(getComputedStyle(active).backgroundColor).toBe('rgba(0, 0, 0, 0)');
  expect(getComputedStyle(active, '::after').height).toBe('2px');
  active.focus();
  expect(getComputedStyle(active).outlineStyle).toBe('solid');

  document.documentElement.dir = 'rtl';
  pane.style.width = '280px';
  expect(close.getBoundingClientRect().right).toBeLessThan(tabs[2]!.getBoundingClientRect().left);
  fireEvent.click(options);
  const menu = document.querySelector('.glossa-notebook-menu')!;
  expect(menu.getBoundingClientRect().left).toBeGreaterThanOrEqual(16);
  expect(menu.getBoundingClientRect().right).toBeLessThanOrEqual(984);
  document.documentElement.setAttribute('data-theme', 'default-dark');
  expect(pane.scrollWidth).toBeLessThanOrEqual(280);
  document.documentElement.setAttribute('data-eink', 'true');
  expect(getComputedStyle(menu).boxShadow).toBe('none');
  expect(getComputedStyle(menu).borderTopWidth).toBe('1px');
  expect(getComputedStyle(active).fontWeight).toBe('700');
  fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Pin Notebook' }), { key: 'Escape' });
  expect(document.activeElement).toBe(options);
  expect(screen.queryByRole('menuitem')).toBeNull();
});
