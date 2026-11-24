import { cleanup, render } from '@testing-library/react';
import { page, userEvent } from 'vitest/browser';
import { afterEach, expect, it, vi } from 'vitest';
import '@/styles/globals.css';
import '@/styles/glossa.css';
import ReaderToolbarSettings, {
  useReaderToolbarLayout,
} from '@/components/settings/ReaderToolbarSettings';

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));

const defaults = useReaderToolbarLayout.getState().layout;

afterEach(() => {
  cleanup();
  useReaderToolbarLayout.setState({ layout: defaults });
  localStorage.removeItem('glossa.readerToolbar');
  for (const attribute of ['data-theme', 'data-eink', 'dir'])
    document.documentElement.removeAttribute(attribute);
  vi.restoreAllMocks();
});

it('applies keyboard reordering and visibility to the shared layout and restores defaults', async () => {
  render(<ReaderToolbarSettings />);
  await page.getByRole('button', { name: 'Move up · Bookmark' }).click();
  await userEvent.keyboard('{Enter}');
  expect(useReaderToolbarLayout.getState().layout.order[0]).toBe('bookmark');

  await page.getByRole('checkbox', { name: 'Bookmark' }).click();
  expect(useReaderToolbarLayout.getState().layout.hidden).toEqual(['bookmark']);
  expect(JSON.parse(localStorage.getItem('glossa.readerToolbar') ?? '{}')).toEqual(
    useReaderToolbarLayout.getState().layout,
  );

  await page.getByRole('button', { name: 'Restore Defaults' }).click();
  expect(useReaderToolbarLayout.getState().layout).toEqual(defaults);
});

it('offers a retry after storage fails and only publishes a saved layout', async () => {
  render(<ReaderToolbarSettings inline />);
  const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
    throw new Error('storage unavailable');
  });
  await page.getByRole('checkbox', { name: 'Bookmark' }).click();
  expect(useReaderToolbarLayout.getState().layout.hidden).toEqual([]);
  await page.getByRole('button', { name: 'Retry saving' }).click();
  expect(setItem).toHaveBeenCalledTimes(2);
  expect(useReaderToolbarLayout.getState().layout.hidden).toEqual(['bookmark']);
});

it.each([
  { theme: 'default-light', dir: 'ltr', eink: false },
  { theme: 'default-dark', dir: 'ltr', eink: false },
  { theme: 'default-light', dir: 'rtl', eink: true },
])('fits the toolbar editor at 320px in $theme ($dir)', async ({ theme, dir, eink }) => {
  await page.viewport(320, 700);
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.setAttribute('data-eink', String(eink));
  document.documentElement.dir = dir;
  const { container } = render(
    <div className='glossa-menu-surface m-2'>
      <ReaderToolbarSettings inline />
    </div>,
  );
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(320);
  for (const element of container.querySelectorAll('button, input')) {
    const { left, right } = element.getBoundingClientRect();
    expect(left).toBeGreaterThanOrEqual(0);
    expect(right).toBeLessThanOrEqual(320);
  }
});
