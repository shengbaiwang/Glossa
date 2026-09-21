import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import ConversationAnswer from '@/glossa/ui/ConversationAnswer';
import type { BookDoc } from '@/libs/document';
import type { ChapterSource } from '@/glossa/context/types';

const f = vi.hoisted(() => ({ resolve: vi.fn(), open: vi.fn() }));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, values?: Record<string, string | number>) =>
    key.replace(/{{(\w+)}}/g, (_, name: string) => String(values?.[name] ?? name)),
}));
vi.mock('@/glossa/citations/sources', () => ({ resolveSource: f.resolve }));
vi.mock('@/utils/clipboard', () => ({ writeTextToClipboard: vi.fn() }));

const source = (id: string): ChapterSource => ({
  sourceId: id,
  text: `Saved ${id}`,
  kind: 'paragraph',
  anchor: {
    sectionIndex: 0,
    cfi: `cfi-${id}`,
    quote: { exact: `Saved ${id}`, prefix: '', suffix: '' },
  },
});
const sources = [source('a'), source('b'), source('unused')];
const props = {
  text: 'First [99](#source-b), again [4](#source-b). Second [原文](#source-a).',
  sources,
  bookDoc: {} as BookDoc,
  sourceLabel: 'Chapter one',
  onSource: f.open,
};
beforeEach(() => {
  vi.resetAllMocks();
  f.resolve.mockImplementation(async (_doc, value: ChapterSource) => ({
    text: `Local ${value.sourceId}`,
    cfi: `verified-${value.sourceId}`,
    recovered: false,
  }));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it('numbers only cited allowed sources in answer order, reuses numbers and opens the selected citation in that list', () => {
  render(<ConversationAnswer {...props} />);
  const links = screen.getAllByRole('link', { name: /^Open source passage/ });
  expect(links.map((link) => link.textContent)).toEqual(['1', '1', '2']);
  expect(f.resolve).not.toHaveBeenCalled();
  fireEvent.click(links[2]!);
  expect(f.open).toHaveBeenCalledWith(sources[0], [sources[1], sources[0]]);
});

it('previews saved direct source-ID fragments and canonical links as the same citation', async () => {
  const saved = source('s-14-abcdef123456');
  render(
    <ConversationAnswer
      {...props}
      sources={[saved]}
      text={`Claim [3](#${saved.sourceId}), repeated [4](#source-${saved.sourceId}). [5](#s-14-missing)`}
    />,
  );
  const links = screen.getAllByRole('link', { name: /^Open source passage/ });
  expect(links.map((link) => link.textContent)).toEqual(['1', '1']);
  expect(document.querySelector('a[href="#s-14-missing"]')).toBeNull();
  fireEvent.mouseOver(links[0]!);
  await screen.findByText(`Local ${saved.sourceId}`);
  expect(f.open).not.toHaveBeenCalled();
  fireEvent.click(links[0]!);
  expect(f.open).toHaveBeenCalledWith(saved, [saved]);
});

it('previews freshly verified local text on keyboard focus without navigating and dismisses with Escape', async () => {
  render(<ConversationAnswer {...props} />);
  const link = screen.getAllByRole('link', { name: /^Open source passage/ })[0]!;
  fireEvent.focusIn(link);
  const preview = await screen.findByRole('tooltip');
  await waitFor(() => expect(preview.textContent).toContain('Local b'));
  expect(preview.textContent).toContain('Chapter one');
  expect(link.getAttribute('aria-describedby')).toBe(preview.id);
  expect(f.open).not.toHaveBeenCalled();
  fireEvent.keyDown(link, { key: 'Escape' });
  expect(screen.queryByRole('tooltip')).toBeNull();
  expect(link.hasAttribute('aria-describedby')).toBe(false);
});

it('marks saved text unverified on failure and still routes clicks through the existing verifier', async () => {
  f.resolve.mockResolvedValue(null);
  render(<ConversationAnswer {...props} />);
  const link = screen.getAllByRole('link', { name: /^Open source passage/ })[0]!;
  fireEvent.focusIn(link);
  await screen.findByText('Saved excerpt · unverified');
  expect(screen.getByRole('tooltip').textContent).toContain('Saved b');
  expect(f.open).not.toHaveBeenCalled();
  fireEvent.click(link);
  expect(screen.queryByRole('tooltip')).toBeNull();
  expect(f.open).toHaveBeenCalledOnce();
});

it('aborts a stale preview when moving to another citation and ignores its late result', async () => {
  let finish!: (value: { text: string; cfi: string }) => void;
  f.resolve.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  render(<ConversationAnswer {...props} />);
  const links = screen.getAllByRole('link', { name: /^Open source passage/ });
  fireEvent.focusIn(links[0]!);
  const signal = f.resolve.mock.calls[0]![2].signal as AbortSignal;
  fireEvent.focusIn(links[2]!);
  await screen.findByText('Local a');
  expect(signal.aborted).toBe(true);
  await act(async () => finish({ text: 'Late b', cfi: 'late-b' }));
  expect(screen.getByRole('tooltip').textContent).not.toContain('Late b');
});

it('invalidates previews when an answer version removes a source', async () => {
  const view = render(<ConversationAnswer {...props} />);
  fireEvent.focusIn(screen.getAllByRole('link', { name: /^Open source passage/ })[0]!);
  await screen.findByText('Local b');
  view.rerender(<ConversationAnswer {...props} sources={[source('a')]} />);
  expect(screen.queryByRole('tooltip')).toBeNull();
  expect(document.querySelector('a[href="#source-b"]')).toBeNull();
});

it('rebuilds the whitelist and preview when the same IDs refer to a different saved version', async () => {
  const view = render(<ConversationAnswer {...props} />);
  fireEvent.focusIn(screen.getAllByRole('link', { name: /^Open source passage/ })[0]!);
  await screen.findByText('Local b');
  const next = { ...source('b'), text: 'Different saved b' };
  view.rerender(<ConversationAnswer {...props} sources={[source('a'), next]} />);
  expect(screen.queryByRole('tooltip')).toBeNull();
  fireEvent.focusIn(screen.getAllByRole('link', { name: /^Open source passage/ })[0]!);
  await waitFor(() =>
    expect(f.resolve).toHaveBeenLastCalledWith(props.bookDoc, next, {
      signal: expect.any(AbortSignal),
    }),
  );
});

it('keeps the preview open while the pointer crosses into it, and cancels the local read when it closes', async () => {
  vi.useFakeTimers();
  render(<ConversationAnswer {...props} />);
  const link = screen.getAllByRole('link', { name: /^Open source passage/ })[0]!;
  fireEvent.mouseOver(link);
  expect(f.resolve).not.toHaveBeenCalled();
  await act(async () => {
    vi.advanceTimersByTime(220);
  });
  const preview = screen.getByRole('tooltip');
  const signal = f.resolve.mock.calls[0]![2].signal as AbortSignal;
  fireEvent.mouseOut(link);
  fireEvent.mouseEnter(preview);
  await act(async () => {
    vi.advanceTimersByTime(400);
  });
  expect(screen.getByRole('tooltip')).toBe(preview);
  fireEvent.mouseLeave(preview);
  await act(async () => {
    vi.advanceTimersByTime(200);
  });
  expect(screen.queryByRole('tooltip')).toBeNull();
  expect(signal.aborted).toBe(true);
});

it('preserves meaningful linked prose, strips invented citations and never treats inline code as a source', () => {
  render(
    <ConversationAnswer
      {...props}
      text={'[A meaningful claim](#source-a) [9](#source-fake) `[1](#source-b)`'}
    />,
  );
  expect(document.querySelector('.glossa-chat-answer')?.textContent).toContain(
    'A meaningful claim',
  );
  expect(screen.getAllByRole('link')).toHaveLength(1);
  expect(document.querySelector('a[href="#source-fake"]')).toBeNull();
  expect(document.querySelector('code')?.textContent).toBe('[1](#source-b)');
});

it('keeps citation bindings after development effect replay and unrelated parent updates', async () => {
  const view = render(
    <StrictMode>
      <ConversationAnswer {...props} />
    </StrictMode>,
  );
  view.rerender(
    <StrictMode>
      <ConversationAnswer {...props} onSource={(...args) => f.open(...args)} />
    </StrictMode>,
  );
  const link = screen.getAllByRole('link', { name: /^Open source passage/ })[0]!;
  expect(link.classList.contains('glossa-chat-source-link')).toBe(true);
  fireEvent.focusIn(link);
  await screen.findByText('Local b');
  fireEvent.keyDown(link, { key: 'Escape' });
  fireEvent.focusIn(link);
  await screen.findByText('Local b');
});
