import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { zipSync, strToU8 } from 'fflate';
import { DocumentLoader } from '@/libs/document';
import type { FoliateView } from '@/types/view';
import { conversationSelectionCfi } from '@/glossa/context/conversation';
import { listChapters } from '@/glossa/context/chapters';
import type { CompletionRequest, ProviderConfig } from '@/glossa/ai/provider';
import { loadConversations, saveConversations, validateHistory } from '@/glossa/conversation/store';
import { useConversationSelection } from '@/glossa/conversation/selection';
import ConversationPanel from '@/glossa/ui/ConversationPanel';
import '@/styles/globals.css';
import '@/styles/glossa.css';
const f = vi.hoisted(() => ({
  complete: vi.fn(),
  config: {
    id: 'fixture',
    name: 'Local fixture',
    baseUrl: 'http://localhost:1234/v1',
    model: 'fixture-model',
  },
}));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, values?: Record<string, string | number>) =>
    key.replace(/{{(\w+)}}/g, (_, name: string) => String(values?.[name] ?? name)),
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: { getState: () => ({ getView: () => view }) },
}));
vi.mock('@/store/readerProgressStore', () => ({
  useBookProgress: () => ({
    location: view?.lastLocation?.cfi,
    sectionLabel: '第一章　从问题走向解释',
    fraction: 0.25,
  }),
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: {
    getState: () => ({
      setSettingsDialogBookKey: vi.fn(),
      setRequestedPanel: vi.fn(),
      setSettingsDialogOpen: vi.fn(),
    }),
  },
}));
vi.mock('@/glossa/ai/provider', async (original) => ({
  ...(await original<typeof import('@/glossa/ai/provider')>()),
  getActiveProviderConfig: () => f.config,
  getProviderStatus: async () => ({ configured: true }),
  validateProviderConfig: (value: ProviderConfig) => value,
  streamCompletion: f.complete,
}));
let view: FoliateView | undefined;
beforeEach(() => {
  f.complete.mockReset();
  useConversationSelection.setState({ selection: null });
});
afterEach(() => {
  cleanup();
  view?.close();
  view?.remove();
  view = undefined;
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-eink');
  document.documentElement.removeAttribute('dir');
});
async function fixture() {
  const files = {
    mimetype: 'application/epub+zip',
    'META-INF/container.xml':
      '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    'content.opf':
      '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">reading-guide-fixture</dc:identifier><dc:title>理解的路径</dc:title><dc:language>zh</dc:language></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/><item id="two" href="two.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="one"/><itemref idref="two"/></spine></package>',
    'nav.xhtml':
      '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>目录</title></head><body><nav epub:type="toc"><ol><li><a href="one.xhtml">第一章　从问题走向解释</a></li><li><a href="two.xhtml">第二章　比较与应用</a></li></ol></nav></body></html>',
    'one.xhtml':
      '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>从问题走向解释</title><style>body{font-family:serif;padding:40px;line-height:2.1}h1{font-size:26px}p{font-size:20px}</style></head><body><h1>第一章　从问题走向解释</h1><p>理解一个观点，需要先找到它回答的问题，再观察作者给出的理由。结论提供方向，理由说明为什么可以朝这个方向思考。</p><p>例子使抽象的理由变得具体。但一个例子能够说明什么，仍然受到它的条件限制。记录例子的同时，也需要记下这些条件。</p><h2>另一个问题</h2><p>ADJACENT_PASSAGE_SENTINEL：这一节尚未选择，只能在本地显示，不能随上一小段外发。</p></body></html>',
    'two.xhtml':
      '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>比较与应用</title></head><body><h1>第二章　比较与应用</h1><p>FUTURE_CHAPTER_SENTINEL：本章正文尚未获准进入模型请求。</p></body></html>',
  };
  const bytes = zipSync(
    Object.fromEntries(Object.entries(files).map(([path, text]) => [path, strToU8(text)])),
  );
  const { book: doc } = await new DocumentLoader(
    new File([new Uint8Array(bytes)], 'reading-guide.epub'),
  ).open();
  return {
    doc,
    chapters: listChapters(doc),
    book: {
      hash: `guide-flow-${crypto.randomUUID()}`,
      title: '理解的路径',
      author: 'Glossa · 原创验收材料',
      format: 'EPUB' as const,
      createdAt: 1,
      updatedAt: 1,
    },
  };
}

async function setup() {
  await page.viewport(1160, 900);
  document.documentElement.setAttribute('data-theme', 'default-light');
  const data = await fixture();
  await import('foliate-js/view.js');
  await import('foliate-js/paginator.js');
  view = document.createElement('foliate-view') as FoliateView;
  Object.assign(view.style, {
    width: '740px',
    height: '900px',
    position: 'absolute',
    left: '0',
    top: '0',
  });
  document.body.append(view);
  await view.open(data.doc);
  view.renderer.setAttribute('max-column-count', '1');
  await view.goTo('one.xhtml');
  const wrapper = () => (
    <div
      data-testid='chat-sidebar'
      className='bg-base-200'
      style={{ width: 420, height: 900, position: 'absolute', right: 0, top: 0 }}
    >
      <ConversationPanel book={data.book} bookDoc={data.doc} bookKey={data.book.hash} />
    </div>
  );
  const panel = render(wrapper());
  await waitFor(() => expect(screen.queryByText('Preparing reading context…')).toBeNull());
  return { ...data, panel, wrapper };
}
function answer(request: CompletionRequest) {
  const payload = JSON.parse(request.messages[1]!.content) as {
    question: string;
    sources: { sourceId: string; text: string }[];
    history: unknown[];
  };
  const raw = JSON.stringify({
    blocks: [
      {
        kind: payload.sources.length ? 'source' : 'background',
        text: '先找到作者回答的问题，再看理由如何支持结论。',
        sourceIds: payload.sources.slice(0, 1).map((s) => s.sourceId),
      },
    ],
  });
  request.onDelta?.(raw);
  return raw;
}
async function ask(question = 'Help explain this passage') {
  fireEvent.change(screen.getByRole('textbox', { name: 'Ask about your reading' }), {
    target: { value: question },
  });
  const button = screen.getByRole('button', { name: 'Send message' });
  await waitFor(
    () => {
      expect(screen.queryByRole('alert')?.textContent ?? '').toBe('');
      expect(button.hasAttribute('disabled')).toBe(false);
    },
    { timeout: 5000 },
  );
  fireEvent.click(button);
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Stop reply' })).toBeNull());
}
it('supports a real EPUB, local restoration, follow-ups, removable context, citation verification and readable themes', async () => {
  f.complete.mockImplementation(async (request: CompletionRequest) => answer(request));
  const { book, panel, wrapper } = await setup();
  expect(f.complete).not.toHaveBeenCalled();
  expect(screen.getByRole('combobox', { name: 'Context' })).toHaveValue('page');
  await ask();
  const request = f.complete.mock.calls[0]![0] as CompletionRequest;
  expect(request.messages[1]!.content).not.toContain('FUTURE_CHAPTER_SENTINEL');
  await waitFor(async () =>
    expect((await loadConversations(book.hash))?.sessions[0]?.turns).toHaveLength(1),
  );
  await ask('Why does that matter?');
  expect(
    JSON.parse((f.complete.mock.calls[1]![0] as CompletionRequest).messages[1]!.content).history,
  ).toHaveLength(1);
  fireEvent.click(screen.getAllByRole('button', { name: 'Check source 1' })[0]!);
  await waitFor(() => expect(screen.queryByText('Checking local source…')).toBeNull());
  const jump = within(screen.getByRole('complementary', { name: 'Original source' })).getByRole(
    'button',
    { name: 'Go to original text' },
  );
  expect(jump.hasAttribute('disabled')).toBe(false);
  fireEvent.click(jump);
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Back to reading position' }).hasAttribute('disabled'),
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Back to reading position' }));
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Back to reading position' })).toBeNull(),
  );
  for (const [theme, width, eink] of [
    ['default-light', 420, false],
    ['default-dark', 420, false],
    ['default-light', 320, true],
  ] as const) {
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.setAttribute('data-eink', String(eink));
    document.documentElement.dir = eink ? 'rtl' : 'ltr';
    const sidebar = screen.getByTestId('chat-sidebar');
    sidebar.style.width = `${width}px`;
    expect(sidebar.scrollWidth).toBeLessThanOrEqual(width);
    expect(screen.getByRole('textbox').getBoundingClientRect().bottom).toBeLessThan(900);
    await page.screenshot({
      path: `../../../../../.glossa-dev/qa/conversation-${theme}-${width}.png`,
    });
  }
  panel.unmount();
  render(wrapper());
  await screen.findByText('Why does that matter?');
  expect(f.complete).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole('button', { name: 'Stop sharing reading context' }));
  await ask('Explain the general idea');
  const noContext = JSON.parse(
    (f.complete.mock.calls[2]![0] as CompletionRequest).messages[1]!.content,
  );
  expect(noContext.sources).toEqual([]);
  expect(noContext.history).toEqual([]);
  fireEvent.click(screen.getByRole('button', { name: 'New conversation' }));
  expect(screen.queryByText('Why does that matter?')).toBeNull();
  expect(
    screen.getByRole('combobox', { name: 'Conversation history' }).querySelectorAll('option'),
  ).toHaveLength(2);
});
it('attaches selections, respects every scope, and scans the whole book only after that scope is selected', async () => {
  f.complete.mockImplementation(async (request: CompletionRequest) => answer(request));
  const { book, doc, chapters } = await setup();
  const rendered = view!.renderer.getContents()[0]!;
  const paragraph = rendered.doc.querySelector('p')!;
  const range = rendered.doc.createRange();
  range.selectNodeContents(paragraph);
  const cfi = conversationSelectionCfi(view!, rendered.index!, range)!;
  const originalDocument = await doc.sections[rendered.index!]!.createDocument();
  const resolvedSelection = doc.resolveCFI!(cfi)?.anchor?.(originalDocument);
  expect(
    resolvedSelection && typeof resolvedSelection !== 'number' ? resolvedSelection.toString() : '',
  ).toBe(paragraph.textContent);
  useConversationSelection.getState().attach(book.hash, cfi);
  await screen.findByRole('button', { name: 'Remove selected text' });
  document.querySelector<HTMLDetailsElement>('.glossa-chat-controls')!.open = true;
  fireEvent.change(screen.getByRole('combobox', { name: 'Context' }), {
    target: { value: 'selection' },
  });
  await ask('Explain this selection');
  const selected = JSON.parse(
    (f.complete.mock.calls[0]![0] as CompletionRequest).messages[1]!.content,
  );
  expect(selected.sources.map((s: { text: string }) => s.text).join(' ')).toBe(
    paragraph.textContent,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Remove selected text' }));
  for (const scope of ['paragraph', 'section', 'article', 'chapter']) {
    document.querySelector<HTMLDetailsElement>('.glossa-chat-controls')!.open = true;
    fireEvent.change(screen.getByRole('combobox', { name: 'Context' }), {
      target: { value: scope },
    });
    if (scope !== 'paragraph')
      fireEvent.change(await screen.findByRole('combobox', { name: 'Choose from contents' }), {
        target: { value: chapters[0]!.id },
      });
    await ask(`Explain ${scope}`);
    expect(
      (f.complete.mock.calls.at(-1)![0] as CompletionRequest).messages[1]!.content,
    ).not.toContain('FUTURE_CHAPTER_SENTINEL');
  }
  const original = doc.sections[1]!.createDocument;
  const readFuture = vi.spyOn(doc.sections[1]!, 'createDocument').mockImplementation(original);
  document.querySelector<HTMLDetailsElement>('.glossa-chat-controls')!.open = true;
  fireEvent.change(screen.getByRole('combobox', { name: 'Context' }), {
    target: { value: 'book' },
  });
  await ask('FUTURE_CHAPTER_SENTINEL');
  expect(readFuture).toHaveBeenCalled();
  const payload = JSON.parse(
    (f.complete.mock.calls.at(-1)![0] as CompletionRequest).messages[1]!.content,
  );
  expect(payload.sources.map((s: { text: string }) => s.text).join(' ')).toContain(
    'FUTURE_CHAPTER_SENTINEL',
  );
  expect(payload.sources.length).toBeLessThanOrEqual(8);
});
it('cancels in-flight replies on stop and close, keeps the question, and rejects invalid saved sources', async () => {
  const { book, panel } = await setup();
  f.complete.mockImplementation(
    (request: CompletionRequest) =>
      new Promise((_, reject) =>
        request.signal!.addEventListener('abort', () =>
          reject(new DOMException('Stopped', 'AbortError')),
        ),
      ),
  );
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Keep this question' } });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Send message' }).hasAttribute('disabled')).toBe(
      false,
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  await screen.findByRole('button', { name: 'Stop reply' });
  fireEvent.click(screen.getByRole('button', { name: 'Stop reply' }));
  await screen.findByText('Reply stopped. Your question is ready to send again.');
  expect(screen.getByRole('textbox')).toHaveValue('Keep this question');
  expect(await loadConversations(book.hash)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  await screen.findByRole('button', { name: 'Stop reply' });
  panel.unmount();
  expect((f.complete.mock.calls.at(-1)![0] as CompletionRequest).signal!.aborted).toBe(true);
  expect(() =>
    validateHistory({ version: 1, bookId: 'other', activeId: 'missing', sessions: [] }),
  ).toThrow();
  await saveConversations({
    version: 1,
    bookId: 'isolated-book',
    activeId: 'a',
    sessions: [{ id: 'a', turns: [] }],
  });
  expect(await loadConversations(book.hash)).toBeNull();
});

it('previews multi-chapter evidence, enforces budgets and removals, and keeps the same focus after navigation', async () => {
  f.complete.mockImplementation(async (request: CompletionRequest) => answer(request));
  const { book, chapters, panel, wrapper } = await setup();
  document.querySelector<HTMLDetailsElement>('.glossa-chat-controls')!.open = true;
  fireEvent.change(screen.getByRole('combobox', { name: 'Context' }), {
    target: { value: 'chapter' },
  });
  fireEvent.change(screen.getByRole('combobox', { name: 'Choose from contents' }), {
    target: { value: chapters[0]!.id },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Add another chapter' }));
  fireEvent.change(screen.getByRole('combobox', { name: 'Choose from contents' }), {
    target: { value: chapters[1]!.id },
  });
  await ask('Compare these chapters');
  const first = JSON.parse(
    (f.complete.mock.calls[0]![0] as CompletionRequest).messages[1]!.content,
  );
  expect(first.metadata).toEqual({
    bookTitle: book.title,
    author: book.author,
    chapterTitle: '第一章　从问题走向解释',
    progress: 0.25,
  });
  expect(
    first.sources.some(
      (source: { chapterTitle: string }) => source.chapterTitle === chapters[0]!.title,
    ),
  ).toBe(true);
  expect(
    first.sources.some(
      (source: { chapterTitle: string }) => source.chapterTitle === chapters[1]!.title,
    ),
  ).toBe(true);
  expect(
    first.sources.reduce((sum: number, source: { text: string }) => sum + source.text.length, 0),
  ).toBeLessThanOrEqual(2000);
  await view!.goTo('two.xhtml');
  panel.rerender(wrapper());
  await ask('Why does that comparison matter?');
  const followup = JSON.parse(
    (f.complete.mock.calls[1]![0] as CompletionRequest).messages[1]!.content,
  );
  expect(followup.sources).toEqual(first.sources);
  expect(followup.history).toHaveLength(1);
  const evidence = document.querySelector<HTMLDetailsElement>(
    '.glossa-chat-context .glossa-chat-evidence:not(.glossa-chat-controls)',
  )!;
  document.querySelector<HTMLDetailsElement>('.glossa-chat-controls')!.open = false;
  evidence.open = true;
  const memory = screen.getByText('Follow-up summary · 2 turns').closest('details')!;
  memory.open = true;
  const checkbox = screen.getByRole('checkbox', { name: 'Include excerpt 1' });
  fireEvent.click(checkbox);
  await screen.findByText('Excluded');
  fireEvent.click(screen.getByRole('checkbox', { name: 'Include follow-up summary' }));
  document.querySelector<HTMLDetailsElement>(
    '.glossa-chat-context .glossa-chat-evidence:not(.glossa-chat-controls)',
  )!.open = true;
  memory.open = false;
  document.querySelector('.glossa-chat-context')!.scrollTop = 0;
  expect(screen.getByRole('textbox').getBoundingClientRect().bottom).toBeLessThan(900);
  await page.screenshot({
    path: '../../../../../.glossa-dev/qa/conversation-context-expanded.png',
  });
  await ask('Explain the remaining materials');
  const adjusted = JSON.parse(
    (f.complete.mock.calls[2]![0] as CompletionRequest).messages[1]!.content,
  );
  expect(
    adjusted.sources.some(
      (source: { sourceId: string }) => source.sourceId === first.sources[0].sourceId,
    ),
  ).toBe(false);
  expect(adjusted.history).toEqual([]);
  await waitFor(async () =>
    expect(
      (await loadConversations(book.hash))?.sessions[0]?.turns.at(-1)?.context?.includeHistory,
    ).toBe(false),
  );
});
