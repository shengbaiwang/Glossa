import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { zipSync, strToU8 } from 'fflate';
import { DocumentLoader } from '@/libs/document';
import type { FoliateView } from '@/types/view';
import { listChapters } from '@/glossa/context/chapters';
import type { CompletionRequest, ProviderConfig } from '@/glossa/ai/provider';
import {
  hasUnsavedConversations,
  loadConversations,
  saveConversations,
  validateHistory,
} from '@/glossa/conversation/store';
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
  getSavedProviderConfigs: () => [f.config],
  listProviderModels: async () => ['fixture-model', 'second-model'],
  saveProviderConfig: async (config: ProviderConfig) => {
    f.config = config;
    window.dispatchEvent(new Event('glossa-model-settings-changed'));
    return config;
  },
  getProviderStatus: async () => ({ configured: true }),
  validateProviderConfig: (value: ProviderConfig) => value,
  streamCompletion: f.complete,
}));
let view: FoliateView | undefined;
beforeEach(() => {
  f.complete.mockReset();
  f.config.model = 'fixture-model';
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
  const raw =
    '先找到作者回答的问题，再看理由如何支持结论。\n\n**理解一个观点**，可以从三个问题开始：\n\n- 它在回应什么？\n- 理由是否支持结论？\n- 换一个条件，结论还成立吗？';
  request.onDelta?.(raw.slice(0, 14));
  request.onDelta?.(raw.slice(14));
  return raw;
}
/** Session naming shares the mocked completion; keep its requests out of chat assertions. */
const isTitleRequest = (request: CompletionRequest) =>
  request.messages.length === 1 &&
  typeof request.messages[0]?.content === 'string' &&
  request.messages[0].content.startsWith('Name this conversation');
const chatCalls = () =>
  f.complete.mock.calls
    .map((call) => call[0] as CompletionRequest)
    .filter((r) => !isTitleRequest(r));
async function ask(question = '如何理解一个观点？') {
  fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), {
    target: { value: question },
  });
  const button = screen.getByRole('button', { name: 'Send message' });
  await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false));
  fireEvent.click(button);
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Stop reply' })).toBeNull());
}
it('chats beside a real EPUB using only identity, restores history, changes models and creates a fresh conversation', async () => {
  f.complete.mockImplementation(async (request: CompletionRequest) => answer(request));
  const { book, doc, panel, wrapper } = await setup();
  const readers = doc.sections.map((section) => vi.spyOn(section, 'createDocument'));
  expect(f.complete).not.toHaveBeenCalled();
  await ask();
  const request = chatCalls()[0]!;
  expect(JSON.parse(request.messages[0]!.content)).toEqual({
    bookTitle: book.title,
    author: book.author,
    chapterTitle: '第一章　从问题走向解释',
  });
  expect(JSON.stringify(request.messages)).not.toMatch(
    /SENTINEL|epubcfi|sourceId|理解一个观点，需要/,
  );
  expect(readers.every((spy) => spy.mock.calls.length === 0)).toBe(true);
  await waitFor(async () =>
    expect((await loadConversations(book.hash))?.sessions[0]?.turns).toHaveLength(1),
  );
  await waitFor(async () =>
    expect((await loadConversations(book.hash))?.sessions[0]?.title).toBe(
      '先找到作者回答的问题，再看理由如何支持结论',
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Choose model' }));
  await screen.findByRole('button', { name: 'second-model' });
  await page.screenshot({
    path: '../../../../../.glossa-dev/qa/conversation-simple-model-picker.png',
  });
  fireEvent.click(screen.getByRole('button', { name: 'second-model' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await ask('能举一个例子吗？');
  const followup = chatCalls()[1]!;
  expect(followup.config?.model).toBe('second-model');
  expect(followup.messages).toHaveLength(4);
  expect(followup.messages[1]!.content).toBe('如何理解一个观点？');
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
      path: `../../../../../.glossa-dev/qa/conversation-simple-${theme}-${width}.png`,
    });
  }
  await waitFor(async () =>
    expect((await loadConversations(book.hash))?.sessions[0]?.turns).toHaveLength(2),
  );
  panel.unmount();
  render(wrapper());
  await screen.findByText('能举一个例子吗？');
  expect(chatCalls()).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: 'New conversation' }));
  await ask('聊个新问题');
  expect(chatCalls()[2]!.messages).toHaveLength(2);
  const saved = await loadConversations(book.hash);
  expect(saved?.sessions).toHaveLength(2);
});
it('keeps partial replies on stop and protects IndexedDB isolation', async () => {
  const { book, panel } = await setup();
  f.complete.mockImplementation((request: CompletionRequest) => {
    request.onDelta?.('已经收到的内容。');
    return new Promise((_, reject) =>
      request.signal!.addEventListener('abort', () =>
        reject(new DOMException('Stopped', 'AbortError')),
      ),
    );
  });
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '请解释' } });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Send message' }).hasAttribute('disabled')).toBe(
      false,
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Stop reply' }));
  await screen.findByText('Stopped');
  await screen.findByText('已经收到的内容。');
  await waitFor(async () =>
    expect((await loadConversations(book.hash))?.sessions[0]?.turns[0]).toMatchObject({
      status: 'stopped',
    }),
  );
  panel.unmount();
  expect(() =>
    validateHistory({ version: 1, bookId: 'other', activeId: 'missing', sessions: [] }),
  ).toThrow();
  await saveConversations({
    version: 1,
    bookId: 'isolated-book',
    activeId: 'a',
    sessions: [{ id: 'a', turns: [] }],
  });
  expect((await loadConversations(book.hash))?.sessions[0]?.turns).toHaveLength(1);
});
it('sends the prompt chosen in the composer picker as the system message', async () => {
  const { saveConversationPrompt } = await import('@/glossa/conversation/prompts');
  saveConversationPrompt({ name: '逐句讲解', content: 'PROMPT_SENTINEL_A' });
  saveConversationPrompt({ name: '只给结论', content: 'PROMPT_SENTINEL_B' });
  f.complete.mockImplementation(async () => '好。');
  await setup();
  fireEvent.click(screen.getByRole('button', { name: 'Choose prompt' }));
  fireEvent.click(await screen.findByRole('button', { name: '只给结论' }));
  await page.screenshot({
    path: '../../../../../.glossa-dev/qa/conversation-prompt-picker.png',
  });
  await ask('这条用哪个提示词？');
  const request = chatCalls()[0]!;
  expect(request.messages[0]).toEqual({ role: 'system', content: 'PROMPT_SENTINEL_B' });
  fireEvent.click(screen.getByRole('button', { name: 'Choose prompt' }));
  fireEvent.click(await screen.findByRole('button', { name: 'No prompt' }));
  await ask('这条不用提示词');
  const plain = chatCalls()[1]!;
  expect(plain.messages.some((message) => message.role === 'system')).toBe(false);
});
it('keeps the composer and model menu usable in a short narrow window', async () => {
  await setup();
  await page.viewport(640, 480);
  const sidebar = screen.getByTestId('chat-sidebar');
  sidebar.style.width = '320px';
  sidebar.style.height = '480px';
  fireEvent.click(screen.getByRole('button', { name: 'Choose model' }));
  await screen.findByRole('button', { name: 'second-model' });
  const menu = screen.getByRole('dialog').getBoundingClientRect();
  expect(menu.top).toBeGreaterThanOrEqual(0);
  expect(menu.bottom).toBeLessThan(480);
  expect(sidebar.scrollWidth).toBeLessThanOrEqual(320);
  await page.screenshot({
    path: '../../../../../.glossa-dev/qa/conversation-simple-narrow-menu.png',
  });
});
it('preserves answer versions, restores a renamed history and lays out math, code and the conversation menu', async () => {
  const original =
    '由关系得到 $E = mc^2$。\n\n$$a^2 + b^2 = c^2$$\n\n```js\nconst energy = mass * c ** 2;\n```';
  const chatAnswers = [original, '另一种解释。', '修改问题后的回答。', '继续解释。'];
  f.complete.mockImplementation(async (request: CompletionRequest) =>
    isTitleRequest(request) ? '公式与条件（自动）' : (chatAnswers.shift() ?? '继续解释。'),
  );
  const { book, panel, wrapper } = await setup();
  await ask('解释这个公式');
  expect(document.querySelectorAll('.glossa-chat-answer math')).toHaveLength(2);
  await screen.findByRole('button', { name: 'Copy code' });
  fireEvent.click(screen.getByRole('button', { name: 'Regenerate reply' }));
  await screen.findByText('另一种解释。');
  fireEvent.click(screen.getByRole('button', { name: 'Edit question' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Edit question' }), {
    target: { value: '解释公式的条件' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Resend' }));
  await screen.findByText('修改问题后的回答。');
  fireEvent.click(screen.getByRole('button', { name: 'Previous answer' }));
  fireEvent.click(screen.getByRole('button', { name: 'Previous answer' }));
  await screen.findByRole('button', { name: 'Copy code' });
  fireEvent.click(screen.getByRole('button', { name: 'Conversation menu' }));
  fireEvent.click(screen.getByRole('button', { name: 'Large' }));
  expect(screen.getByRole('button', { name: 'Copy code' })).toBeTruthy();
  await ask('接着讲');
  const request = chatCalls()[3]!;
  expect(request.messages.filter((message) => message.role === 'assistant')).toEqual([
    { role: 'assistant', content: original },
  ]);
  expect(JSON.stringify(request.messages)).not.toMatch(/另一种解释|修改问题|解释公式的条件/);
  fireEvent.click(screen.getByRole('button', { name: 'Conversation menu' }));
  fireEvent.click(screen.getByRole('button', { name: 'Rename conversation' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Conversation name' }), {
    target: { value: '公式与条件' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(async () =>
    expect((await loadConversations(book.hash))?.sessions[0]?.title).toBe('公式与条件'),
  );
  panel.unmount();
  render(wrapper());
  await screen.findByRole('option', { name: '公式与条件' });
  await screen.findByRole('button', { name: 'Copy code' });
  await waitFor(() => expect(hasUnsavedConversations(book.hash)).toBe(false));
  expect(screen.queryByText('Conversation not saved.')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Search conversations' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Search conversations' }), {
    target: { value: '另一种解释' },
  });
  expect(document.querySelector('.glossa-chat-search-snippet')?.textContent).toContain(
    '另一种解释',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Search conversations' }));
  const sidebar = screen.getByTestId('chat-sidebar');
  for (const [theme, width, eink] of [
    ['default-light', 420, false],
    ['default-dark', 420, false],
    ['default-light', 320, true],
  ] as const) {
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.setAttribute('data-eink', String(eink));
    document.documentElement.dir = eink ? 'rtl' : 'ltr';
    sidebar.style.width = `${width}px`;
    fireEvent.click(screen.getByRole('button', { name: 'Conversation menu' }));
    const menu = screen.getByRole('dialog', { name: 'Conversation menu' }).getBoundingClientRect();
    const bounds = sidebar.getBoundingClientRect();
    expect(menu.left).toBeGreaterThanOrEqual(bounds.left);
    expect(menu.right).toBeLessThanOrEqual(bounds.right);
    expect(sidebar.scrollWidth).toBeLessThanOrEqual(width);
    await page.screenshot({
      path: `../../../../../.glossa-dev/qa/conversation-audit-${theme}-${width}.png`,
    });
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Conversation menu' }), { key: 'Escape' });
  }
  await page.viewport(640, 480);
  sidebar.style.height = '480px';
  expect(screen.queryByRole('button', { name: 'Expand input' })).toBeNull();
  fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), {
    target: { value: '需要梳理的条件。\n'.repeat(100) },
  });
  const inputBounds = screen.getByRole('textbox', { name: 'Message' }).getBoundingClientRect();
  expect(inputBounds.height).toBeGreaterThan(76);
  expect(inputBounds.height).toBeLessThanOrEqual(180);
  const sendBounds = screen.getByRole('button', { name: 'Send message' }).getBoundingClientRect();
  expect(sendBounds.bottom).toBeLessThanOrEqual(480);
  expect(sendBounds.top).toBeGreaterThan(0);
  expect(sidebar.scrollWidth).toBeLessThanOrEqual(320);
  await page.screenshot({
    path: '../../../../../.glossa-dev/qa/conversation-audit-long-input-narrow.png',
  });
});
