import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import PDFScaleControls from '@/app/reader/components/footerbar/PDFScaleControls';
const state = vi.hoisted(() => ({
  pdf: true,
  save: vi.fn(async (..._args: unknown[]) => {}),
  set: vi.fn(),
  settings: { zoomMode: 'fit-width', zoomLevel: 180 },
}));
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    disconnect() {}
  },
);
const renderer = document.createElement('div');
Object.defineProperty(renderer, 'scale', { get: () => 1.5 });
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (s: string) => s }));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {} }) }));
vi.mock('@/helpers/settings', () => ({
  saveViewSettings: (...args: unknown[]) => state.save(...args),
}));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({
    getBookData: () => ({ book: { format: state.pdf ? 'PDF' : 'EPUB' } }),
  }),
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    getView: () => ({ renderer, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    getViewSettings: () => state.settings,
    setViewSettings: state.set,
  }),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.pdf = true;
});
it('shows the real page scale and resets extra magnification when fitting a page', async () => {
  render(<PDFScaleControls bookKey='book' />);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Zoom 150%' }).textContent).toContain('150%'),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Fit Page' }));
  expect(renderer.getAttribute('zoom')).toBe('fit-page');
  expect(renderer.getAttribute('scale-factor')).toBe('100');
  expect(state.set).toHaveBeenCalledWith(
    'book',
    expect.objectContaining({ zoomMode: 'fit-page', zoomLevel: 100 }),
  );
  await waitFor(() =>
    expect(state.save).toHaveBeenCalledWith({}, 'book', 'zoomMode', 'fit-page', true, false, true),
  );
  expect(state.save).toHaveBeenCalledWith({}, 'book', 'zoomLevel', 100, true, false, true);
});
it('retains the live scale and offers an explicit retry when saving fails', async () => {
  state.save.mockRejectedValueOnce(new Error('disk full'));
  render(<PDFScaleControls bookKey='book' />);
  fireEvent.click(screen.getByRole('button', { name: 'Fit Width' }));
  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
});
it('leaves reflowable books with their existing navigation', () => {
  state.pdf = false;
  render(<PDFScaleControls bookKey='book' />);
  expect(screen.queryByRole('group', { name: 'Zoom' })).toBeNull();
});
