import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Book } from '@/types/book';
import type { BookDoc } from '@/libs/document';
import type { ChapterSource } from '@/glossa/context/types';
import { useConversationSelection } from '@/glossa/conversation/selection';
import { ConversationError } from '@/glossa/conversation/schema';
const f = vi.hoisted(() => ({
  load: vi.fn(),
  save: vi.fn(),
  read: vi.fn(),
  generate: vi.fn(),
  status: vi.fn(),
  location: 'page-one',
}));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: { getState: () => ({ getView: () => ({ lastLocation: { cfi: f.location } }) }) },
}));
vi.mock('@/store/readerProgressStore', () => ({
  useBookProgress: () => ({
    location: f.location,
    sectionLabel: f.location === 'page-one' ? 'Chapter one' : 'Chapter two',
    fraction: f.location === 'page-one' ? 0.1 : 0.6,
  }),
}));
vi.mock('@/glossa/context/conversation', async (original) => ({
  ...(await original<typeof import('@/glossa/context/conversation')>()),
  createConversationReader: () => ({ visibleLocation: () => f.location, readLocation: f.read }),
}));
vi.mock('@/glossa/context/chapters', () => ({ listChapters: () => [] }));
vi.mock('@/glossa/conversation/store', async (original) => ({
  ...(await original<typeof import('@/glossa/conversation/store')>()),
  loadConversations: f.load,
  saveConversations: f.save,
  hasUnsavedConversations: () => false,
}));
vi.mock('@/glossa/conversation/generate', async (original) => ({
  ...(await original<typeof import('@/glossa/conversation/generate')>()),
  generateConversation: f.generate,
}));
vi.mock('@/glossa/ai/provider', async (original) => ({
  ...(await original<typeof import('@/glossa/ai/provider')>()),
  getActiveProviderConfig: () => ({
    id: 'fixture',
    name: 'Fixture',
    baseUrl: 'http://localhost:1234/v1',
    model: 'fixture',
  }),
  getProviderStatus: f.status,
}));
import ConversationPanel from '@/glossa/ui/ConversationPanel';
const source: ChapterSource = {
  sourceId: 's1',
  text: 'An original sentence.',
  kind: 'paragraph',
  anchor: {
    sectionIndex: 0,
    cfi: 'epubcfi(/6/2!/4/2)',
    quote: { exact: 'An original sentence.', prefix: '', suffix: '' },
  },
};
const blocks = [{ kind: 'source', text: 'The explanation.', sourceIds: ['s1'] }];
const book = () => ({ hash: crypto.randomUUID(), title: 'Fixture', format: 'EPUB' }) as Book;
beforeEach(() => {
  vi.clearAllMocks();
  useConversationSelection.setState({ selection: null });
  f.location = 'page-one';
  f.load.mockResolvedValue(null);
  f.save.mockResolvedValue(undefined);
  f.read.mockResolvedValue([source]);
  f.status.mockResolvedValue({ configured: true });
  f.generate.mockResolvedValue(blocks);
});
afterEach(cleanup);
const mount = (b = book()) =>
  render(<ConversationPanel book={b} bookDoc={{} as BookDoc} bookKey={b.hash} />);
async function typeQuestion() {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Explain this' } });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Send message' }).hasAttribute('disabled')).toBe(
      false,
    ),
  );
}
it('does no model work on open, and handles IME and Shift+Enter without sending', async () => {
  mount();
  await typeQuestion();
  expect(f.generate).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', isComposing: true });
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', shiftKey: true });
  expect(f.generate).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
  await waitFor(() =>
    expect(document.querySelector('.glossa-chat-answer p')?.textContent).toBe('The explanation.'),
  );
  expect(f.generate).toHaveBeenCalledTimes(1);
});
it('retains the answer after a save failure and offers a working retry', async () => {
  f.save.mockRejectedValueOnce(new Error('disk unavailable'));
  mount();
  await typeQuestion();
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  await waitFor(() =>
    expect(document.querySelector('.glossa-chat-answer p')?.textContent).toBe('The explanation.'),
  );
  await screen.findByRole('button', { name: 'Retry saving' });
  fireEvent.click(screen.getByRole('button', { name: 'Retry saving' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry saving' })).toBeNull());
  expect(f.generate).toHaveBeenCalledTimes(1);
  expect(f.save).toHaveBeenCalledTimes(2);
});
it('does not overwrite unreadable history and supports loading it again', async () => {
  f.load.mockRejectedValueOnce(new ConversationError('Conversations could not be loaded.'));
  mount();
  await screen.findByText('Conversations could not be loaded.');
  expect(screen.getByRole('button', { name: 'Send message' }).hasAttribute('disabled')).toBe(true);
  expect(f.save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await typeQuestion();
});
it('retains the question after generation fails and does not persist an invalid reply', async () => {
  f.generate.mockRejectedValueOnce(
    new ConversationError('The reply was incomplete or cited unavailable sources. Try again.'),
  );
  mount();
  await typeQuestion();
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  await screen.findByRole('alert');
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Explain this');
  expect(f.save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  await waitFor(() =>
    expect(document.querySelector('.glossa-chat-answer p')?.textContent).toBe('The explanation.'),
  );
});
it('rejects stale context while a new page capture is pending', async () => {
  const b = book();
  const doc = {} as BookDoc;
  const panel = render(<ConversationPanel book={b} bookDoc={doc} bookKey={b.hash} />);
  await typeQuestion();
  let finish!: (sources: ChapterSource[]) => void;
  f.read.mockImplementationOnce(
    () =>
      new Promise<ChapterSource[]>((resolve) => {
        finish = resolve;
      }),
  );
  f.location = 'page-two';
  panel.rerender(<ConversationPanel book={b} bookDoc={doc} bookKey={b.hash} />);
  await waitFor(() =>
    expect(f.read).toHaveBeenCalledWith('page-two', expect.any(AbortSignal), false),
  );
  expect(screen.getByRole('button', { name: 'Send message' }).hasAttribute('disabled')).toBe(true);
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
  expect(f.generate).not.toHaveBeenCalled();
  await act(async () => finish([{ ...source, sourceId: 's2' }]));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Send message' }).hasAttribute('disabled')).toBe(
      false,
    ),
  );
});
it('offers model setup when credentials are missing', async () => {
  f.status.mockResolvedValue({ configured: false });
  mount();
  await screen.findByText(/Setup needed/);
  expect(screen.getByRole('button', { name: 'Send message' }).hasAttribute('disabled')).toBe(true);
  expect(f.generate).not.toHaveBeenCalled();
});

it('keeps follow-up materials stable across page turns and lets readers return to the page', async () => {
  const b = { ...book(), author: 'Fixture author' };
  const doc = {} as BookDoc;
  const panel = render(<ConversationPanel book={b} bookDoc={doc} bookKey={b.hash} />);
  await typeQuestion();
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  await waitFor(() =>
    expect(document.querySelector('.glossa-chat-answer p')?.textContent).toBe('The explanation.'),
  );
  f.location = 'page-two';
  f.read.mockResolvedValue([{ ...source, sourceId: 's2' }]);
  panel.rerender(<ConversationPanel book={b} bookDoc={doc} bookKey={b.hash} />);
  await typeQuestion();
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  await waitFor(() => expect(f.generate).toHaveBeenCalledTimes(2));
  expect(f.generate.mock.calls[1]![0].sources).toEqual([source]);
  expect(f.generate.mock.calls[1]![0].metadata).toEqual({
    bookTitle: b.title,
    author: 'Fixture author',
    chapterTitle: 'Chapter two',
    progress: 0.6,
  });
  fireEvent.click(await screen.findByRole('button', { name: 'Use current reading materials' }));
  await typeQuestion();
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  await waitFor(() => expect(f.generate).toHaveBeenCalledTimes(3));
  expect(f.generate.mock.calls[2]![0].sources[0].sourceId).toBe('s2');
});
it('lets readers remove individual evidence and disable follow-up memory', async () => {
  mount();
  await typeQuestion();
  fireEvent.click(
    screen.getByRole('checkbox', { name: 'Include excerpt {{number}}', hidden: true }),
  );
  fireEvent.click(
    screen.getByRole('checkbox', { name: 'Include follow-up summary', hidden: true }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  await waitFor(() => expect(f.generate).toHaveBeenCalledTimes(1));
  expect(f.generate.mock.calls[0]![0].sources).toEqual([]);
  expect(f.generate.mock.calls[0]![0].includeHistory).toBe(false);
});

it('cancels the old reply when a new reading selection becomes the focus', async () => {
  const b = book();
  f.generate.mockImplementationOnce(
    (request) =>
      new Promise((_, reject) =>
        request.signal.addEventListener('abort', () =>
          reject(new DOMException('Aborted', 'AbortError')),
        ),
      ),
  );
  mount(b);
  await typeQuestion();
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  await screen.findByRole('button', { name: 'Stop reply' });
  act(() => useConversationSelection.getState().attach(b.hash, 'new-selection'));
  await screen.findByText('Reply stopped. Your question is ready to send again.');
  expect(f.generate.mock.calls[0]![0].signal.aborted).toBe(true);
  expect(f.save).not.toHaveBeenCalled();
  await waitFor(() =>
    expect(f.read).toHaveBeenCalledWith('new-selection', expect.any(AbortSignal)),
  );
});
