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
const view = { renderer, addEventListener: vi.fn(), removeEventListener: vi.fn() };
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
    getView: () => view,
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

function openScaleMenu() {
  fireEvent.keyDown(screen.getByRole('button', { name: /^Zoom [\d.]+%$/ }), { key: 'ArrowDown' });
}

it('accepts an exact typed percentage and cancels a draft with Escape', async () => {
  render(<PDFScaleControls bookKey='book' />);
  openScaleMenu();
  const input = await screen.findByRole<HTMLInputElement>('textbox', { name: 'Zoom' });
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: '137.25%' } });
  expect(state.save).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(renderer.getAttribute('scale-factor')).toBe('137.25');
  await waitFor(() =>
    expect(state.save).toHaveBeenCalledWith({}, 'book', 'zoomLevel', 137.25, true, false, true),
  );
  fireEvent.change(input, { target: { value: '192' } });
  fireEvent.keyDown(input, { key: 'Escape' });
  fireEvent.blur(input);
  expect(renderer.getAttribute('scale-factor')).toBe('137.25');
});

it('previews continuous slider values without saving every move, then commits the final value', async () => {
  render(<PDFScaleControls bookKey='book' />);
  openScaleMenu();
  const slider = await screen.findByRole<HTMLInputElement>('slider', { name: 'Zoom' });
  expect(slider.step).toBe('any');
  fireEvent.pointerDown(slider);
  fireEvent.change(slider, { target: { value: '137.25' } });
  fireEvent.change(slider, { target: { value: '141.75' } });
  await waitFor(() => expect(renderer.getAttribute('scale-factor')).toBe('141.75'));
  expect(state.save).not.toHaveBeenCalled();
  expect(renderer.hasAttribute('zoom-preview')).toBe(true);
  fireEvent.pointerUp(slider);
  expect(renderer.hasAttribute('zoom-preview')).toBe(false);
  await waitFor(() =>
    expect(state.save).toHaveBeenCalledWith({}, 'book', 'zoomLevel', 141.75, true, false, true),
  );
  expect(state.save).toHaveBeenCalledTimes(2);
});

it('keeps zoom responsive while a previous setting is saving and persists the latest choice', async () => {
  let finish!: () => void;
  state.save.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  render(<PDFScaleControls bookKey='book' />);
  fireEvent.click(screen.getByRole('button', { name: 'Fit Page' }));
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Fit Width' }).disabled).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Fit Width' }));
  expect(renderer.getAttribute('zoom')).toBe('fit-width');
  finish();
  await waitFor(() =>
    expect(state.save).toHaveBeenLastCalledWith({}, 'book', 'zoomLevel', 100, true, false, true),
  );
  expect(
    state.save.mock.calls.filter((args) => args[2] === 'zoomMode').map((args) => args[3]),
  ).toEqual(['fit-page', 'fit-width']);
});

it('clears an unfinished zoom preview when its controls are unmounted', async () => {
  const { unmount } = render(<PDFScaleControls bookKey='book' />);
  openScaleMenu();
  const slider = await screen.findByRole<HTMLInputElement>('slider', { name: 'Zoom' });
  fireEvent.change(slider, { target: { value: '163.25' } });
  await waitFor(() => expect(renderer.hasAttribute('zoom-preview')).toBe(true));
  unmount();
  expect(renderer.hasAttribute('zoom-preview')).toBe(false);
  expect(state.save).not.toHaveBeenCalled();
});
