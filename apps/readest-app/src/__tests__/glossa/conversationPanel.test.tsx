import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Book } from '@/types/book';
import type { BookDoc } from '@/libs/document';
import { ConversationError } from '@/glossa/conversation/schema';
const f = vi.hoisted(() => ({
  load: vi.fn(),
  save: vi.fn(),
  generate: vi.fn(),
  title: vi.fn(),
  status: vi.fn(),
  list: vi.fn(),
  saveConfig: vi.fn(),
  location: 'one',
  model: 'fixture',
  baseUrl: 'http://localhost:1234/v1',
  effort: undefined as string | undefined,
  sectionHref: undefined as string | undefined,
  settings: vi.fn(),
}));
const clipboard = vi.hoisted(() => ({ write: vi.fn() }));
vi.mock('@/utils/clipboard', () => ({ writeTextToClipboard: clipboard.write }));
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
  generateConversationTitle: f.title,
}));
vi.mock('@/glossa/ai/provider', async (original) => ({
  ...(await original<typeof import('@/glossa/ai/provider')>()),
  getActiveProviderConfig: () => ({
    id: 'fixture',
    name: 'Fixture',
    baseUrl: f.baseUrl,
    model: f.model,
    ...(f.effort ? { reasoningEffort: f.effort } : {}),
  }),
  getSavedProviderConfigs: () => [
    {
      id: 'fixture',
      name: 'Fixture',
      baseUrl: f.baseUrl,
      model: f.model,
      ...(f.effort ? { reasoningEffort: f.effort } : {}),
    },
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
  f.baseUrl = 'http://localhost:1234/v1';
  f.effort = undefined;
  f.sectionHref = undefined;
  f.load.mockResolvedValue(null);
  f.save.mockResolvedValue(undefined);
  f.status.mockResolvedValue({ configured: true });
  f.generate.mockResolvedValue('The **explanation**.');
  f.title.mockResolvedValue('');
  clipboard.write.mockReset().mockResolvedValue(undefined);
  f.list.mockResolvedValue(['fixture', 'second-model']);
  f.saveConfig.mockImplementation(async (config) => {
    f.model = config.model;
    f.effort = config.reasoningEffort;
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
  fireEvent.click(screen.getByRole('button', { name: 'Conversation menu' }));
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
it('keeps regenerated answers as versions and sends only the selected one afterwards', async () => {
  f.generate.mockResolvedValueOnce('First answer').mockResolvedValueOnce('Second answer');
  mount();
  await typeQuestion('First question');
  send();
  await waitFor(() =>
    expect(document.querySelector('.glossa-chat-answer')?.textContent).toBe('First answer'),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Regenerate reply' }));
  await waitFor(() =>
    expect(document.querySelector('.glossa-chat-answer')?.textContent).toBe('Second answer'),
  );
  expect(document.querySelector('.glossa-chat-version-count')?.textContent).toBe('2/2');
  fireEvent.click(screen.getByRole('button', { name: 'Previous answer' }));
  await waitFor(() =>
    expect(document.querySelector('.glossa-chat-answer')?.textContent).toBe('First answer'),
  );
  expect(document.querySelector('.glossa-chat-version-count')?.textContent).toBe('1/2');
  await typeQuestion('Follow up');
  send();
  await waitFor(() => expect(f.generate).toHaveBeenCalledTimes(3));
  const turns = f.generate.mock.calls[2]![0].turns;
  expect(turns).toHaveLength(1);
  expect(turns[0]!.question).toBe('First question');
  expect(turns[0]!.blocks[0]!.text).toBe('First answer');
});
it('upgrades a legacy conversation turn when its answer is regenerated', async () => {
  const b = book();
  const legacy = {
    id: 'legacy-turn',
    question: 'Legacy question',
    blocks: [{ kind: 'background', text: 'Legacy answer', sourceIds: [] }],
    sources: [],
    createdAt: 1,
    provider: {
      id: 'fixture',
      name: 'Fixture',
      baseUrl: 'http://localhost:1234/v1',
      model: 'fixture',
    },
    promptVersion: 'conversation-2',
  };
  f.load.mockResolvedValueOnce({
    version: 1,
    bookId: b.hash,
    activeId: 'a',
    sessions: [{ id: 'a', turns: [legacy] }],
  });
  mount(b);
  await waitFor(() =>
    expect(document.querySelector('.glossa-chat-question')?.textContent).toBe('Legacy question'),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Regenerate reply' }));
  await waitFor(() => expect(f.save).toHaveBeenCalledTimes(1));
  const turn = f.save.mock.calls[0]![0].sessions[0].turns[0];
  expect(turn.promptVersion).toBe('conversation-3');
  expect(turn.versions).toHaveLength(2);
  expect(turn.versions[0].text).toBe('Legacy answer');
  expect(turn.blocks[0].text).toBe('The **explanation**.');
});
it('edits the last question, retains the previous answer as a version, and can switch back', async () => {
  f.generate.mockResolvedValueOnce('First answer').mockResolvedValueOnce('Second answer');
  mount();
  await typeQuestion('First question');
  send();
  await waitFor(() =>
    expect(document.querySelector('.glossa-chat-answer')?.textContent).toBe('First answer'),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Edit question' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Edit question' }), {
    target: { value: 'Second question' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Resend' }));
  await waitFor(() => expect(f.generate).toHaveBeenCalledTimes(2));
  expect(f.generate.mock.calls[1]![0].question).toBe('Second question');
  expect(f.generate.mock.calls[1]![0].turns).toEqual([]);
  await waitFor(() =>
    expect(document.querySelector('.glossa-chat-answer')?.textContent).toBe('Second answer'),
  );
  expect(document.querySelector('.glossa-chat-question')?.textContent).toBe('Second question');
  expect(document.querySelector('.glossa-chat-version-count')?.textContent).toBe('2/2');
  fireEvent.click(screen.getByRole('button', { name: 'Previous answer' }));
  await waitFor(() =>
    expect(document.querySelector('.glossa-chat-answer')?.textContent).toBe('First answer'),
  );
  expect(document.querySelector('.glossa-chat-question')?.textContent).toBe('First question');
});
it('cancels an edit without sending', async () => {
  mount();
  await typeQuestion('Kept question');
  send();
  await answer();
  fireEvent.click(screen.getByRole('button', { name: 'Edit question' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Edit question' }), {
    target: { value: 'Discarded question' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('textbox', { name: 'Edit question' })).toBeNull();
  expect(document.querySelector('.glossa-chat-question')?.textContent).toBe('Kept question');
  expect(f.generate).toHaveBeenCalledTimes(1);
});
it('renames the active conversation and shows the name in the switcher', async () => {
  mount();
  await typeQuestion('A question');
  send();
  await answer();
  fireEvent.click(screen.getByRole('button', { name: 'Conversation menu' }));
  fireEvent.click(screen.getByRole('button', { name: 'Rename conversation' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Conversation name' }), {
    target: { value: 'Reading notes' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() =>
    expect(
      (screen.getByRole('combobox', { name: 'Conversation history' }) as HTMLSelectElement)
        .selectedOptions[0]?.textContent,
    ).toBe('Reading notes'),
  );
  expect(f.save.mock.calls.at(-1)![0].sessions[0].title).toBe('Reading notes');
});
it('searches the book history and switches to a matching conversation', async () => {
  mount();
  await typeQuestion('First subject');
  send();
  await answer();
  fireEvent.click(screen.getByRole('button', { name: 'New conversation' }));
  await typeQuestion('Second subject');
  send();
  await waitFor(() => expect(f.generate).toHaveBeenCalledTimes(2));
  fireEvent.click(screen.getByRole('button', { name: 'Search conversations' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Search conversations' }), {
    target: { value: 'First subject' },
  });
  const result = document.querySelector('.glossa-chat-search-results button');
  expect(result?.textContent).toContain('First subject');
  fireEvent.click(result!);
  await waitFor(() =>
    expect(document.querySelector('.glossa-chat-question')?.textContent).toBe('First subject'),
  );
});
it('grows the composer automatically and accepts a question up to the raised limit', async () => {
  mount();
  const input = screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement;
  expect(input.maxLength).toBe(20000);
  expect(screen.queryByRole('button', { name: 'Expand input' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Collapse input' })).toBeNull();
  expect(document.querySelector('.glossa-chat-count')).toBeNull();
  fireEvent.change(input, { target: { value: 'x'.repeat(20000) } });
  expect(document.querySelector('.glossa-chat-count')?.textContent).toBe('20000/20000');
  expect(Number.parseInt(input.style.height)).toBeLessThanOrEqual(180);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Send message' }).hasAttribute('disabled')).toBe(
      false,
    ),
  );
  send();
  await waitFor(() => expect(f.generate).toHaveBeenCalledOnce());
  expect(f.generate.mock.calls[0]![0].question).toHaveLength(20000);
});
it('names a new conversation from its first completed reply only', async () => {
  f.title.mockResolvedValue('阅读笔记：第一章');
  mount();
  await typeQuestion();
  send();
  await answer();
  await waitFor(() =>
    expect(
      (screen.getByRole('combobox', { name: 'Conversation history' }) as HTMLSelectElement)
        .selectedOptions[0]?.textContent,
    ).toBe('阅读笔记：第一章'),
  );
  expect(f.title).toHaveBeenCalledTimes(1);
  expect(f.title.mock.calls[0]![0]).toMatchObject({
    question: 'Explain this',
    answer: 'The **explanation**.',
  });
  expect(f.save.mock.calls.at(-1)![0].sessions[0].title).toBe('阅读笔记：第一章');
  await typeQuestion('Follow up');
  send();
  await waitFor(() => expect(f.save.mock.calls.at(-1)![0].sessions[0].turns).toHaveLength(2));
  expect(f.title).toHaveBeenCalledTimes(1);
});
it('keeps a manual name when the suggested title arrives later', async () => {
  let resolveTitle!: (title: string) => void;
  f.title.mockImplementation(
    () =>
      new Promise<string>((done) => {
        resolveTitle = done;
      }),
  );
  mount();
  await typeQuestion();
  send();
  await answer();
  await waitFor(() => expect(f.title).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('button', { name: 'Conversation menu' }));
  fireEvent.click(screen.getByRole('button', { name: 'Rename conversation' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Conversation name' }), {
    target: { value: 'My name' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await act(async () => resolveTitle('Suggested'));
  expect(f.save.mock.calls.at(-1)![0].sessions[0].title).toBe('My name');
});
it('keeps the question label without an error when naming fails', async () => {
  f.title.mockRejectedValue(new Error('offline'));
  mount();
  await typeQuestion('Why does this matter?');
  send();
  await answer();
  await waitFor(() => expect(f.title).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(
    (screen.getByRole('combobox', { name: 'Conversation history' }) as HTMLSelectElement)
      .selectedOptions[0]?.textContent,
  ).toBe('Why does this matter?');
});
it('adjusts reasoning effort from the composer for capable models only', async () => {
  mount();
  expect(screen.queryByRole('combobox', { name: 'Reasoning effort' })).toBeNull();
  cleanup();
  f.baseUrl = 'https://api.openai.com/v1';
  f.model = 'gpt-5';
  mount();
  const select = await screen.findByRole('combobox', { name: 'Reasoning effort' });
  fireEvent.change(select, { target: { value: 'high' } });
  await waitFor(() =>
    expect(f.saveConfig).toHaveBeenCalledWith(expect.objectContaining({ reasoningEffort: 'high' })),
  );
  await waitFor(() =>
    expect(
      (screen.getByRole('combobox', { name: 'Reasoning effort' }) as HTMLSelectElement).value,
    ).toBe('high'),
  );
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
it('renders math formulas as MathML from a reply', async () => {
  f.generate.mockResolvedValue('Mass is $E = mc^2$.\n\n$$a^2 + b^2 = c^2$$');
  mount();
  await typeQuestion();
  send();
  await waitFor(() => expect(document.querySelector('.glossa-chat-answer math')).toBeTruthy());
  expect(document.querySelectorAll('.glossa-chat-answer math')).toHaveLength(2);
  expect(
    document.querySelector('.glossa-chat-answer annotation[encoding="application/x-tex"]')
      ?.textContent,
  ).toBe('E = mc^2');
});
it('copies a code block and confirms it', async () => {
  f.generate.mockResolvedValue('```\nconst x = 1;\n```');
  mount();
  await typeQuestion();
  send();
  const button = await screen.findByRole('button', { name: 'Copy code' });
  fireEvent.click(button);
  await waitFor(() => expect(clipboard.write).toHaveBeenCalledWith('const x = 1;\n'));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy());
});
it('keeps text size inside the conversation menu and restores its selection', async () => {
  mount();
  expect(screen.queryByRole('button', { name: 'Text size' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Conversation menu' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Large' }));
  expect(document.querySelector('.glossa-chat-panel')?.getAttribute('style')).toContain(
    '--glossa-chat-answer-size: 16px',
  );
  expect(screen.queryByRole('dialog', { name: 'Conversation menu' })).toBeNull();
  expect(localStorage.getItem('glossa.conversation-font.v1')).toBe('large');
});
it('shows a recoverable error when code copying fails', async () => {
  clipboard.write.mockRejectedValueOnce(new Error('clipboard unavailable'));
  f.generate.mockResolvedValue('```\nconst x = 1;\n```');
  mount();
  await typeQuestion();
  send();
  fireEvent.click(await screen.findByRole('button', { name: 'Copy code' }));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
  await screen.findByRole('button', { name: 'Copied' });
});
it('keeps code copying available while typing and changing text size', async () => {
  f.generate.mockResolvedValue('```\nconst x = 1;\n```');
  mount();
  await typeQuestion();
  send();
  await screen.findByRole('button', { name: 'Copy code' });
  fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), {
    target: { value: 'Next question' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Conversation menu' }));
  fireEvent.click(screen.getByRole('button', { name: 'Large' }));
  fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
  await waitFor(() => expect(clipboard.write).toHaveBeenCalledWith('const x = 1;\n'));
});
it('keeps an edited question available when resending fails', async () => {
  f.generate.mockResolvedValueOnce('Original answer').mockRejectedValueOnce(new Error('offline'));
  mount();
  await typeQuestion('Original question');
  send();
  fireEvent.click(await screen.findByRole('button', { name: 'Edit question' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Edit question' }), {
    target: { value: 'Revised question' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Resend' }));
  await screen.findByText('The reply could not be completed. Try again.');
  expect(
    (screen.getByRole('textbox', { name: 'Edit question' }) as HTMLTextAreaElement).value,
  ).toBe('Revised question');
  expect(screen.getByText('Original answer')).toBeTruthy();
});
it('can find a retained answer even when another version is selected', async () => {
  f.generate.mockResolvedValueOnce('FIRST_VERSION_SENTINEL').mockResolvedValueOnce('New answer');
  mount();
  await typeQuestion();
  send();
  fireEvent.click(await screen.findByRole('button', { name: 'Regenerate reply' }));
  await screen.findByText('New answer');
  fireEvent.click(screen.getByRole('button', { name: 'Search conversations' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Search conversations' }), {
    target: { value: 'FIRST_VERSION_SENTINEL' },
  });
  expect(screen.queryByText('No matches')).toBeNull();
  expect(document.querySelector('.glossa-chat-search-snippet')?.textContent).toContain(
    'FIRST_VERSION_SENTINEL',
  );
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
