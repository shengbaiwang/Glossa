import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Book } from '@/types/book';
import type { BookDoc } from '@/libs/document';
import { ConversationError } from '@/glossa/conversation/schema';
const f = vi.hoisted(() => ({
  load: vi.fn(),
  save: vi.fn(),
  generate: vi.fn(),
  status: vi.fn(),
  list: vi.fn(),
  saveConfig: vi.fn(),
  location: 'one',
  model: 'fixture',
  sectionHref: undefined as string | undefined,
  settings: vi.fn(),
}));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/store/readerProgressStore', () => ({
  useBookProgress: () => ({
    sectionHref: f.sectionHref,
    sectionLabel: `Chapter ${f.location}`,
    fraction: 0.1,
  }),
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: {
    getState: () => ({
      setSettingsDialogBookKey: vi.fn(),
      setRequestedPanel: vi.fn(),
      setSettingsDialogOpen: f.settings,
    }),
  },
}));
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
    model: f.model,
  }),
  getSavedProviderConfigs: () => [
    { id: 'fixture', name: 'Fixture', baseUrl: 'http://localhost:1234/v1', model: f.model },
  ],
  getProviderStatus: f.status,
  listProviderModels: f.list,
  saveProviderConfig: f.saveConfig,
}));
import ConversationPanel from '@/glossa/ui/ConversationPanel';
import { MODEL_SETTINGS_EVENT } from '@/glossa/ai/provider';
const book = () =>
  ({ hash: crypto.randomUUID(), title: 'Fixture', author: 'Writer', format: 'EPUB' }) as Book;
beforeEach(() => {
  vi.clearAllMocks();
  f.location = 'one';
  f.model = 'fixture';
  f.sectionHref = undefined;
  f.load.mockResolvedValue(null);
  f.save.mockResolvedValue(undefined);
  f.status.mockResolvedValue({ configured: true });
  f.generate.mockResolvedValue('The **explanation**.');
  f.list.mockResolvedValue(['fixture', 'second-model']);
  f.saveConfig.mockImplementation(async (config) => {
    f.model = config.model;
    window.dispatchEvent(new Event(MODEL_SETTINGS_EVENT));
    return config;
  });
});
afterEach(cleanup);
const mount = (b = book(), doc = {} as BookDoc) =>
  render(<ConversationPanel book={b} bookDoc={doc} bookKey={b.hash} />);
async function typeQuestion(question = 'Explain this') {
  fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), {
    target: { value: question },
  });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Send message' }).hasAttribute('disabled')).toBe(
      false,
    ),
  );
}
const send = () => fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
async function answer() {
  await waitFor(() =>
    expect(document.querySelector('.glossa-chat-answer')?.textContent).toBe('The explanation.'),
  );
}
function holdReply(text = '') {
  f.generate.mockImplementationOnce((request) => {
    if (text) request.onText(text);
    return new Promise((_, reject) =>
      request.signal.addEventListener('abort', () =>
        reject(new DOMException('Aborted', 'AbortError')),
      ),
    );
  });
}
it('does no book/API work on open and uses only identity when sending; IME and Shift+Enter never send', async () => {
  const read = vi.fn();
  mount(book(), { sections: [{ createDocument: read }] } as unknown as BookDoc);
  await typeQuestion();
  expect(f.generate).not.toHaveBeenCalled();
  expect(read).not.toHaveBeenCalled();
  expect(f.list).not.toHaveBeenCalled();
  expect(screen.queryByText('Adjust materials')).toBeNull();
  expect(document.querySelector('.glossa-chat-context')).toBeNull();
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', isComposing: true });
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', shiftKey: true });
  expect(f.generate).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
  await answer();
  expect(f.generate.mock.calls[0]![0].metadata).toEqual({
    bookTitle: 'Fixture',
    author: 'Writer',
    chapterTitle: 'Chapter one',
  });
  expect(f.generate.mock.calls[0]![0]).not.toHaveProperty('sources');
  expect(read).not.toHaveBeenCalled();
});
it('sends the full outline path as hidden identity without rendering it', async () => {
  f.sectionHref = 'one.xhtml#a';
  const doc = {
    toc: [
      {
        id: 0,
        index: 0,
        label: 'Part One',
        href: 'one.xhtml',
        subitems: [{ id: 1, index: 0, label: 'Section A', href: 'one.xhtml#a' }],
      },
      { id: 2, index: 0, label: 'Part Two', href: 'two.xhtml' },
    ],
    sections: [
      { id: 'one.xhtml', href: 'one.xhtml', linear: 'yes' },
      { id: 'two.xhtml', href: 'two.xhtml', linear: 'yes' },
    ],
    splitTOCHref: (href: string) => href.split('#'),
  } as unknown as BookDoc;
  mount(book(), doc);
  expect(document.querySelector('.glossa-chat-book')).toBeNull();
  await typeQuestion();
  send();
  await answer();
  expect(f.generate.mock.calls[0]![0].metadata.chapterTitle).toBe('Part One › Section A');
});
it('retains the answer after a save failure and retries without generating again', async () => {
  f.save.mockRejectedValueOnce(new Error('disk unavailable'));
  mount();
  await typeQuestion();
  send();
  await answer();
  fireEvent.click(await screen.findByRole('button', { name: 'Retry saving' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry saving' })).toBeNull());
  expect(f.generate).toHaveBeenCalledTimes(1);
  expect(f.save).toHaveBeenCalledTimes(2);
});
it('never overwrites unreadable history and supports loading again', async () => {
  f.load.mockRejectedValueOnce(new ConversationError('Conversations could not be loaded.'));
  mount();
  await screen.findByText('Conversations could not be loaded.');
  expect(f.save).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Send message' }).hasAttribute('disabled')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await typeQuestion();
});
it('restores the question after generation fails without persisting an empty reply', async () => {
  f.generate.mockRejectedValueOnce(new Error('secret network payload'));
  mount();
  await typeQuestion();
  send();
  await screen.findByRole('alert');
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Explain this');
  expect(screen.queryByText('secret network payload')).toBeNull();
  expect(f.save).not.toHaveBeenCalled();
  send();
  await answer();
});
it('keeps conversation messages while the current directory section changes', async () => {
  const b = book();
  const panel = mount(b);
  await typeQuestion();
  send();
  await answer();
  f.location = 'two';
  panel.rerender(<ConversationPanel book={b} bookDoc={{} as BookDoc} bookKey={b.hash} />);
  await typeQuestion('Why?');
  send();
  await waitFor(() => expect(f.generate).toHaveBeenCalledTimes(2));
  expect(f.generate.mock.calls[1]![0].metadata.chapterTitle).toBe('Chapter two');
  expect(f.generate.mock.calls[1]![0].turns).toHaveLength(1);
});
it('opens model setup when credentials are missing', async () => {
  f.status.mockResolvedValue({ configured: false });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Set up a model' }));
  expect(f.settings).toHaveBeenCalledWith(true);
});
it('switches models directly and continues the same conversation', async () => {
  mount();
  await typeQuestion();
  send();
  await answer();
  fireEvent.click(screen.getByRole('button', { name: 'Choose model' }));
  fireEvent.click(await screen.findByRole('button', { name: 'second-model' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await typeQuestion('Go on');
  send();
  await waitFor(() => expect(f.generate).toHaveBeenCalledTimes(2));
  expect(f.generate.mock.calls[1]![0].config.model).toBe('second-model');
  expect(f.generate.mock.calls[1]![0].turns).toHaveLength(1);
});
it('accepts a manual model if listing is unavailable and closes the picker with Escape', async () => {
  f.list.mockRejectedValue(new Error('no list'));
  mount();
  await typeQuestion();
  fireEvent.click(screen.getByRole('button', { name: 'Choose model' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Search or enter model' }), {
    target: { value: 'manual-model' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'manual-model' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(f.saveConfig).toHaveBeenCalledWith(expect.objectContaining({ model: 'manual-model' }));
  fireEvent.click(screen.getByRole('button', { name: 'Choose model' }));
  fireEvent.keyDown(screen.getByRole('textbox', { name: 'Search or enter model' }), {
    key: 'Escape',
  });
  expect(screen.queryByRole('dialog')).toBeNull();
});
it('starts an empty conversation, restores per-session drafts, and deletes only the chosen session', async () => {
  mount();
  await typeQuestion();
  send();
  await answer();
  await typeQuestion('Unsent first draft');
  const oldId = (
    screen.getByRole('combobox', { name: 'Conversation history' }) as HTMLSelectElement
  ).value;
  fireEvent.click(screen.getByRole('button', { name: 'New conversation' }));
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('');
  expect(document.querySelector('.glossa-chat-answer')).toBeNull();
  await typeQuestion('A new subject');
  send();
  await answer();
  expect(f.generate.mock.calls[1]![0].turns).toEqual([]);
  fireEvent.change(screen.getByRole('combobox', { name: 'Conversation history' }), {
    target: { value: oldId },
  });
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Unsent first draft');
  fireEvent.click(screen.getByRole('button', { name: 'Delete conversation' }));
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
  expect(screen.queryByText('Explain this')).toBeNull();
  expect(document.querySelector('.glossa-chat-question')?.textContent).toBe('A new subject');
});
it('stops immediately, preserves partial text and ignores a late completion after starting a new session', async () => {
  let resolve!: (text: string) => void;
  f.generate.mockImplementationOnce((r) => {
    r.onText('Partial reply');
    return new Promise<string>((done) => {
      resolve = done;
    });
  });
  mount();
  await typeQuestion();
  send();
  fireEvent.click(await screen.findByRole('button', { name: 'Stop reply' }));
  await screen.findByText('Stopped');
  expect(screen.getByText('Partial reply')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'New conversation' }));
  await act(async () => resolve('LATE_REPLY'));
  expect(screen.queryByText('LATE_REPLY')).toBeNull();
  expect(f.save.mock.calls[0]![0].sessions[0].turns[0].status).toBe('stopped');
});
it('cancels on model change and on close, preserving a question with no reply', async () => {
  holdReply();
  const readingBook = book();
  const panel = mount(readingBook);
  await typeQuestion();
  send();
  await screen.findByRole('button', { name: 'Stop reply' });
  act(() => {
    f.model = 'changed';
    window.dispatchEvent(new Event(MODEL_SETTINGS_EVENT));
  });
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Stop reply' })).toBeNull());
  expect(f.generate.mock.calls[0]![0].signal.aborted).toBe(true);
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Explain this');
  holdReply();
  await typeQuestion();
  send();
  panel.unmount();
  expect(f.generate.mock.calls[1]![0].signal.aborted).toBe(true);
  mount(readingBook);
  await waitFor(() =>
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Explain this'),
  );
});
it('regenerates the last reply without adding a duplicate or sending its old answer', async () => {
  mount();
  await typeQuestion();
  send();
  await answer();
  fireEvent.click(screen.getByRole('button', { name: 'Regenerate reply' }));
  await waitFor(() => expect(f.save).toHaveBeenCalledTimes(2));
  expect(f.generate.mock.calls[1]![0].turns).toEqual([]);
  expect(f.save.mock.calls[1]![0].sessions[0].turns).toHaveLength(1);
});
it('a failed regeneration retains the previous valid answer', async () => {
  mount();
  await typeQuestion();
  send();
  await answer();
  f.generate.mockRejectedValueOnce(new Error('failed'));
  fireEvent.click(screen.getByRole('button', { name: 'Regenerate reply' }));
  await screen.findByRole('alert');
  await answer();
  expect(f.save).toHaveBeenCalledTimes(1);
});
it('renders Markdown without executing HTML or loading remote images', async () => {
  f.generate.mockResolvedValue(
    '**Safe** ![alt](https://example.com/tracker.png) <script>evil()</script> [bad](javascript:evil())',
  );
  mount();
  await typeQuestion();
  send();
  await waitFor(() =>
    expect(document.querySelector('.glossa-chat-answer strong')?.textContent).toBe('Safe'),
  );
  expect(
    document.querySelector(
      '.glossa-chat-answer img, .glossa-chat-answer script, .glossa-chat-answer a[href^="javascript:"]',
    ),
  ).toBeNull();
});
it('restores an unsent first draft after closing and opens a genuinely empty new conversation', async () => {
  const b = book();
  const first = mount(b);
  await typeQuestion('Keep this draft');
  first.unmount();
  mount(b);
  await waitFor(() =>
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Keep this draft'),
  );
  fireEvent.click(screen.getByRole('button', { name: 'New conversation' }));
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('');
});
it('keeps a draft typed during a failed reply and can retry the original question', async () => {
  let fail!: (error: Error) => void;
  f.generate.mockImplementationOnce(
    () =>
      new Promise((_, reject) => {
        fail = reject;
      }),
  );
  mount();
  await typeQuestion('Original question');
  send();
  await screen.findByRole('button', { name: 'Stop reply' });
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Next draft' } });
  await act(async () => fail(new Error('offline')));
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Next draft');
  fireEvent.click(screen.getByRole('button', { name: 'Retry reply' }));
  await answer();
  expect(f.generate.mock.calls[1]![0].question).toBe('Original question');
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Next draft');
});
