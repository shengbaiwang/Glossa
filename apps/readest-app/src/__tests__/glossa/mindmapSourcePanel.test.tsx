import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Book } from '@/types/book';
import type { BookDoc } from '@/libs/document';
import type { ChapterSource } from '@/glossa/context/types';
import type { ResolvedSource } from '@/glossa/citations/sources';
import MindmapSourcePanel, { type MindmapSourceSelection } from '@/glossa/ui/MindmapSourcePanel';

const f = vi.hoisted(() => ({
  resolve: vi.fn(),
  navigate: vi.fn(),
  progress: vi.fn(),
  reveal: vi.fn(),
}));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/glossa/citations/sources', () => ({ resolveSource: f.resolve }));
vi.mock('@/glossa/citations/navigation', () => ({ navigateSource: f.navigate }));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: {
    getState: () => ({ getView: () => ({}), getProgress: f.progress }),
  },
}));

const props = { book: { hash: 'book' } as Book, bookDoc: {} as BookDoc, bookKey: 'view' };
const source = (id: string): ChapterSource => ({
  sourceId: id,
  text: `Saved text ${id}`,
  kind: 'paragraph',
  anchor: {
    sectionIndex: 0,
    cfi: `saved-cfi-${id}`,
    quote: { exact: `Saved text ${id}`, prefix: '', suffix: '' },
  },
});
const selection = (nodeId: string, ids = [nodeId]): MindmapSourceSelection => ({
  nodeId,
  sources: ids.map(source),
});
const resolved = (id: string): ResolvedSource => ({
  cfi: `verified-cfi-${id}`,
  text: `Fresh local text ${id}`,
  recovered: true,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const mount = (value = selection('first')) =>
  render(<MindmapSourcePanel {...props} selection={value} onNavigate={f.reveal} />);

afterEach(cleanup);
beforeEach(() => {
  vi.resetAllMocks();
  f.resolve.mockImplementation(async (_book: BookDoc, value: ChapterSource) =>
    resolved(value.sourceId),
  );
  f.navigate.mockResolvedValue(undefined);
  f.progress.mockReturnValue({ location: 'reading-start' });
});

describe('mind map original passage lifecycle', () => {
  it('shows freshly resolved local text and navigates only to the verified location', async () => {
    mount();
    await screen.findByText('Fresh local text first');
    expect(screen.queryByText('Saved text first')).toBeNull();
    expect(f.resolve).toHaveBeenCalledWith(props.bookDoc, source('first'), {
      signal: expect.any(AbortSignal),
    });
    expect(f.navigate).toHaveBeenCalledWith({}, 'verified-cfi-first', expect.any(AbortSignal));
    await waitFor(() => expect(f.reveal).toHaveBeenCalledOnce());
    expect(screen.queryByText('Saved excerpt · unverified')).toBeNull();
  });

  it('refuses unresolved locations and retries verification before navigating', async () => {
    f.resolve.mockResolvedValueOnce(null);
    mount();
    await screen.findByRole('alert');
    expect(f.navigate).not.toHaveBeenCalled();
    expect(f.reveal).not.toHaveBeenCalled();
    expect(screen.getByText('Saved excerpt · unverified')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText('Fresh local text first');
    expect(f.resolve).toHaveBeenCalledTimes(2);
    expect(f.navigate).toHaveBeenCalledOnce();
  });

  it('aborts a previous node lookup and ignores its late text and navigation', async () => {
    const first = deferred<ResolvedSource | null>();
    f.resolve.mockReturnValueOnce(first.promise);
    const view = mount();
    const firstSignal = f.resolve.mock.calls[0]![2].signal as AbortSignal;
    view.rerender(
      <MindmapSourcePanel {...props} selection={selection('second')} onNavigate={f.reveal} />,
    );
    await screen.findByText('Fresh local text second');
    expect(firstSignal.aborted).toBe(true);
    await act(async () => first.resolve(resolved('first')));
    expect(screen.queryByText('Fresh local text first')).toBeNull();
    expect(f.navigate).toHaveBeenCalledTimes(1);
    expect(f.navigate).toHaveBeenCalledWith({}, 'verified-cfi-second', expect.any(AbortSignal));
    expect(f.reveal).toHaveBeenCalledOnce();
  });

  it('keeps the first return point when a late renderer jump is superseded by another node', async () => {
    const jump = deferred<void>();
    f.navigate.mockReturnValueOnce(jump.promise);
    const view = mount();
    await waitFor(() => expect(f.navigate).toHaveBeenCalledOnce());
    const firstSignal = f.navigate.mock.calls[0]![2] as AbortSignal;
    f.progress.mockReturnValue({ location: 'intermediate-location' });
    view.rerender(
      <MindmapSourcePanel {...props} selection={selection('second')} onNavigate={f.reveal} />,
    );
    await waitFor(() => expect(f.reveal).toHaveBeenCalledOnce());
    await act(async () => jump.resolve());
    expect(firstSignal.aborted).toBe(true);
    expect(f.reveal).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Back to reading position' }));
    await waitFor(() =>
      expect(f.navigate).toHaveBeenLastCalledWith({}, 'reading-start', expect.any(AbortSignal)),
    );
  });

  it('moves between each supplied source and resets to the first source for another node', async () => {
    const view = mount(selection('idea', ['one', 'two']));
    await screen.findByText('Fresh local text one');
    expect(screen.getByRole('button', { name: 'Previous passage' }).hasAttribute('disabled')).toBe(
      true,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Next passage' }));
    await screen.findByText('Fresh local text two');
    expect(screen.getByRole('button', { name: 'Next passage' }).hasAttribute('disabled')).toBe(
      true,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Previous passage' }));
    await screen.findByText('Fresh local text one');
    fireEvent.click(screen.getByRole('button', { name: 'Next passage' }));
    await screen.findByText('Fresh local text two');
    view.rerender(
      <MindmapSourcePanel
        {...props}
        selection={selection('another', ['three', 'four'])}
        onNavigate={f.reveal}
      />,
    );
    await screen.findByText('Fresh local text three');
    expect(screen.getByRole('button', { name: 'Previous passage' }).hasAttribute('disabled')).toBe(
      true,
    );
    expect(f.resolve.mock.calls.map(([, value]) => (value as ChapterSource).sourceId)).toEqual([
      'one',
      'two',
      'one',
      'two',
      'three',
    ]);
  });

  it.each([
    'close',
    'unmount',
  ] as const)('cancels pending resolution on %s without showing late results', async (action) => {
    const lookup = deferred<ResolvedSource | null>();
    f.resolve.mockReturnValueOnce(lookup.promise);
    const view = mount();
    const signal = f.resolve.mock.calls[0]![2].signal as AbortSignal;
    if (action === 'close')
      fireEvent.click(screen.getByRole('button', { name: 'Close source excerpt' }));
    else view.unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => lookup.resolve(resolved('first')));
    expect(f.navigate).not.toHaveBeenCalled();
    expect(f.reveal).not.toHaveBeenCalled();
    expect(screen.queryByRole('complementary', { name: 'Source excerpt' })).toBeNull();
  });

  it('preserves the reading position after failed return and retries that return directly', async () => {
    mount();
    await waitFor(() => expect(f.reveal).toHaveBeenCalledOnce());
    f.navigate.mockRejectedValueOnce(new Error('Renderer failed'));
    fireEvent.click(screen.getByRole('button', { name: 'Back to reading position' }));
    await screen.findByText('Could not return to the previous reading position.');
    expect(screen.getByRole('button', { name: 'Back to reading position' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(f.navigate).toHaveBeenCalledTimes(3));
    expect(f.resolve).toHaveBeenCalledOnce();
    expect(f.navigate).toHaveBeenLastCalledWith({}, 'reading-start', expect.any(AbortSignal));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Back to reading position' })).toBeNull(),
    );
  });
});
