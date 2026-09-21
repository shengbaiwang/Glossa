import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { zipSync, strToU8 } from 'fflate';
import { DocumentLoader } from '@/libs/document';
import { listChapters } from '@/glossa/context/chapters';
import type { FoliateView } from '@/types/view';
import type { CompletionRequest, ToolCompletionRequest } from '@/glossa/ai/provider';
import { loadConversations, saveConversations } from '@/glossa/conversation/store';
import { currentAnswerVersion } from '@/glossa/conversation/schema';
import ConversationPanel from '@/glossa/ui/ConversationPanel';
import '@/styles/globals.css';
import '@/styles/glossa.css';

const f = vi.hoisted(() => ({
  complete: vi.fn(),
  toolComplete: vi.fn(),
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
  useReaderStore: {
    getState: () => ({
      getView: () => view,
      getProgress: () => ({ location: view?.lastLocation?.cfi }),
    }),
  },
}));
vi.mock('@/store/readerProgressStore', () => ({
  useBookProgress: () => ({
    location: view?.lastLocation?.cfi,
    sectionLabel: '第一章　理解与理由',
    fraction: 0.1,
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
  listProviderModels: async () => ['fixture-model'],
  getProviderStatus: async () => ({ configured: true }),
  streamCompletion: f.complete,
  streamToolCompletion: f.toolComplete,
}));

let view: FoliateView | undefined;
beforeEach(() => {
  f.complete.mockReset();
  f.toolComplete.mockReset();
  f.complete.mockImplementation(async (request: CompletionRequest) =>
    request.messages[0]?.content.startsWith('Name this conversation') ? '理解与理由' : '普通对话。',
  );
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

const firstParagraph =
  '理解一个观点，需要先找到它回答的问题，再观察作者给出的理由。结论提供方向，理由说明为什么可以朝这个方向思考。';
async function setup() {
  await page.viewport(1160, 900);
  document.documentElement.setAttribute('data-theme', 'default-light');
  const files = {
    mimetype: 'application/epub+zip',
    'META-INF/container.xml':
      '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    'content.opf':
      '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">harness-original-fixture</dc:identifier><dc:title>理解与理由</dc:title><dc:language>zh</dc:language></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/><item id="two" href="two.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="one"/><itemref idref="two"/></spine></package>',
    'nav.xhtml':
      '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>目录</title></head><body><nav epub:type="toc"><ol><li><a href="one.xhtml">第一章　理解与理由</a></li><li><a href="two.xhtml">第二章　比较与应用</a></li></ol></nav></body></html>',
    'one.xhtml': `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>理解与理由</title><style>body{font-family:serif;padding:40px;line-height:2.1}h1{font-size:26px}p{font-size:22px}</style></head><body><h1>第一章　理解与理由</h1><p id="first">${firstParagraph}</p>${Array.from({ length: 22 }, (_, i) => `<p>第${i + 1}个例子帮助我们观察条件。一个例子能够说明什么，受到这些条件限制。记录例子的同时，也应当记录条件。</p>`).join('')}<h2>稍后的讨论</h2><p>OFF_PAGE_SENTINEL：这一页没有获准进入模型请求。</p></body></html>`,
    'two.xhtml':
      '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>比较与应用</title></head><body><h1>第二章　比较与应用</h1><p>FUTURE_CHAPTER_SENTINEL：另一章没有获准进入模型请求。</p></body></html>',
  };
  const bytes = zipSync(
    Object.fromEntries(Object.entries(files).map(([path, text]) => [path, strToU8(text)])),
  );
  const { book: bookDoc } = await new DocumentLoader(
    new File([new Uint8Array(bytes)], 'harness.epub'),
  ).open();
  const book = {
    hash: `harness-browser-${crypto.randomUUID()}`,
    title: '理解与理由',
    author: 'Glossa · 原创验收材料',
    format: 'EPUB' as const,
    createdAt: 1,
    updatedAt: 1,
  };
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
  await view.open(bookDoc);
  view.renderer.setAttribute('max-column-count', '1');
  await view.goTo('one.xhtml');
  await waitFor(() => expect(view!.lastLocation?.range?.collapsed).toBe(false));
  const wrapper = () => (
    <div
      data-testid='harness-sidebar'
      className='bg-base-200'
      style={{ width: 420, height: 900, position: 'absolute', right: 0, top: 0 }}
    >
      <ConversationPanel book={book} bookDoc={bookDoc} bookKey={book.hash} />
    </div>
  );
  const panel = render(wrapper());
  await screen.findByRole('button', { name: 'Use book text' });
  return { book, bookDoc, panel, wrapper };
}

async function ask(question: string) {
  fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), {
    target: { value: question },
  });
  const send = screen.getByRole('button', { name: 'Send message' });
  await waitFor(() => expect(send.hasAttribute('disabled')).toBe(false));
  fireEvent.click(send);
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Stop reply' })).toBeNull());
}
const call = (name: string, args: Record<string, unknown>) => ({
  text: '',
  toolCalls: [
    {
      id: `call-${name}`,
      type: 'function' as const,
      function: { name, arguments: JSON.stringify(args) },
    },
  ],
});

it.each([
  'canonical',
  'direct',
] as const)('restores a real EPUB snapshot and previews %s citations with verified return navigation', async (format) => {
  const { book, panel, wrapper } = await setup();
  fireEvent.click(screen.getByRole('button', { name: 'Use book text' }));
  await screen.findByRole('button', { name: 'Current page' });
  expect(f.complete).not.toHaveBeenCalled();
  expect(f.toolComplete).not.toHaveBeenCalled();
  await waitFor(async () =>
    expect(
      (await loadConversations(book.hash))?.sessions[0]?.readingScope?.sources.length,
    ).toBeGreaterThan(0),
  );
  const originalScope = (await loadConversations(book.hash))!.sessions[0]!.readingScope!;
  fireEvent.click(screen.getByRole('button', { name: 'Current page' }));
  expect(
    document.querySelector('details[open] .glossa-chat-reading-preview')?.textContent,
  ).toContain(firstParagraph);
  fireEvent.keyDown(screen.getByRole('button', { name: 'Current page' }), { key: 'Escape' });
  expect(JSON.stringify(originalScope)).toContain(firstParagraph);
  expect(JSON.stringify(originalScope)).not.toMatch(/OFF_PAGE_SENTINEL|FUTURE_CHAPTER_SENTINEL/);
  let sourceId = '';
  f.toolComplete.mockImplementation(async (request: ToolCompletionRequest) => {
    const results = request.messages.filter((message) => message.role === 'tool');
    if (!results.length) return call('get_outline', {});
    if (results.length === 1) return call('search_book', { query: '作者给出的理由', limit: 1 });
    if (results.length === 2) {
      sourceId = JSON.parse(results[1]!.content).sources[0].sourceId;
      return call('read_passage', { sourceIds: [sourceId] });
    }
    const text = `作者建议先找问题，再核对理由如何支持结论。[原文](#${format === 'canonical' ? 'source-' : ''}${sourceId})\n\n**我的理解：** 把结论放回它回答的问题中，能更清楚地判断理由是否充分。`;
    request.onDelta?.(text);
    return { text, toolCalls: [] };
  });
  await ask('如何理解这段？');
  await screen.findByRole('link', { name: /^Open source passage/ });
  expect(f.toolComplete).toHaveBeenCalledTimes(4);
  const requests = f.toolComplete.mock.calls.map(([request]) => request as ToolCompletionRequest);
  expect(JSON.stringify(requests.map((request) => request.messages))).not.toMatch(
    /OFF_PAGE_SENTINEL|FUTURE_CHAPTER_SENTINEL|epubcfi/,
  );
  expect(requests.at(-1)!.messages.filter((message) => message.role === 'tool')).toHaveLength(3);
  await waitFor(async () =>
    expect((await loadConversations(book.hash))?.sessions[0]?.turns).toHaveLength(1),
  );
  const saved = (await loadConversations(book.hash))!.sessions[0]!;
  expect(
    currentAnswerVersion(saved.turns[0]!).reading?.sources.some(
      (source) => source.sourceId === sourceId,
    ),
  ).toBe(true);
  await view!.goTo('two.xhtml');
  const origin = view!.lastLocation!.cfi!;
  panel.unmount();
  if (format === 'direct') {
    // Reproduce historical answers saved before fragment normalization existed.
    const history = (await loadConversations(book.hash))!;
    const turn = history.sessions[0]!.turns[0]!;
    for (const block of turn.blocks) block.text = block.text.replaceAll('#source-', '#');
    if ('versions' in turn)
      for (const version of turn.versions ?? [])
        version.text = version.text.replaceAll('#source-', '#');
    await saveConversations(history);
  }
  render(wrapper());
  await screen.findByRole('button', { name: 'Current page' });
  expect((await loadConversations(book.hash))!.sessions[0]!.readingScope).toEqual(originalScope);
  const navigation = vi.spyOn(view!, 'goTo');
  const citation = await screen.findByRole('link', { name: /^Open source passage/ });
  expect(citation.textContent).toBe('1');
  await page.getByRole('link', { name: /^Open source passage/ }).hover();
  const tooltip = await screen.findByRole('tooltip');
  await waitFor(() => expect(tooltip.textContent).toContain(firstParagraph));
  await waitFor(() => expect(tooltip.querySelector('[role="status"]')).toBeNull());
  expect(view!.lastLocation?.cfi).toBe(origin);
  expect(navigation).not.toHaveBeenCalled();
  await page.screenshot({
    path: `../../../../../.glossa-dev/qa/citations/preview-${format}-light.png`,
  });
  fireEvent.keyDown(citation, { key: 'Escape' });
  expect(screen.queryByRole('tooltip')).toBeNull();
  fireEvent.click(await screen.findByRole('link', { name: /^Open source passage/ }));
  const excerpt = await screen.findByRole('complementary', { name: 'Source excerpt' });
  await waitFor(() =>
    expect(excerpt.querySelector('blockquote')?.textContent).toBe(firstParagraph),
  );
  await waitFor(() => expect(view!.resolveCFI(view!.lastLocation!.cfi!).index).toBe(0));
  const sourceDocument = view!.renderer.getContents()[0]!.doc;
  const highlightWindow = sourceDocument.defaultView as Window & typeof globalThis;
  await waitFor(() => expect(highlightWindow.CSS.highlights.has('glossa-source')).toBe(true));
  expect(
    [...highlightWindow.CSS.highlights.get('glossa-source')!]
      .map((range) => range.toString())
      .join(''),
  ).toBe(firstParagraph);
  expect(sourceDocument.getSelection()?.toString()).toBe('');
  expect(screen.queryByRole('alert')).toBeNull();
  for (const [theme, width, eink, dir] of [
    ['default-light', 420, false, 'ltr'],
    ['default-dark', 420, false, 'ltr'],
    ['default-dark', 320, false, 'rtl'],
    ['default-light', 320, true, 'rtl'],
  ] as const) {
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.setAttribute('data-eink', String(eink));
    document.documentElement.dir = dir;
    const sidebar = screen.getByTestId('harness-sidebar');
    sidebar.style.width = `${width}px`;
    expect(sidebar.scrollWidth).toBeLessThanOrEqual(width);
    expect(
      screen.getByRole('textbox', { name: 'Message' }).getBoundingClientRect().bottom,
    ).toBeLessThanOrEqual(900);
    await page.screenshot({
      path: `../../../../../.glossa-dev/qa/harness/reading-${theme}-${width}-${eink ? 'eink' : dir}.png`,
    });
  }
  const back = screen.getByRole('button', { name: 'Back to reading position' });
  await waitFor(() => expect(back.hasAttribute('disabled')).toBe(false));
  fireEvent.click(back);
  await waitFor(() => expect(navigation.mock.calls.at(-1)?.[0]).toBe(origin));
  await waitFor(() => expect(view!.lastLocation?.cfi).toBe(origin));
  expect(highlightWindow.CSS.highlights.has('glossa-source')).toBe(false);
  expect(f.toolComplete).toHaveBeenCalledTimes(4);
});

it('attaches only an explicit clipped selection and keeps subsequent page moves outside the request', async () => {
  const { book } = await setup();
  const doc = view!.renderer.getContents()[0]!.doc;
  const textNode = doc.getElementById('first')!.firstChild!;
  const range = doc.createRange();
  range.setStart(textNode, 0);
  range.setEnd(textNode, 6);
  const selection = doc.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  await page.getByRole('button', { name: 'Use book text' }).click();
  await screen.findByRole('button', { name: 'Selected text' });
  await waitFor(async () =>
    expect((await loadConversations(book.hash))?.sessions[0]?.readingScope?.sources).toHaveLength(
      1,
    ),
  );
  expect((await loadConversations(book.hash))!.sessions[0]!.readingScope!.sources[0]!.text).toBe(
    '理解一个观点',
  );
  expect(f.toolComplete).not.toHaveBeenCalled();
  await view!.goTo('two.xhtml');
  f.toolComplete.mockImplementation(async (request: ToolCompletionRequest) => {
    const evidence = JSON.parse(request.messages[1]!.content!);
    const text = `这段提出了理解观点这一主题。[原文](#source-${evidence.sources[0].sourceId})`;
    request.onDelta?.(text);
    return { text, toolCalls: [] };
  });
  await ask('这里的意思是什么？');
  const request = f.toolComplete.mock.calls[0]![0] as ToolCompletionRequest;
  expect(
    JSON.parse(request.messages[1]!.content!).sources.map(
      (source: { text: string }) => source.text,
    ),
  ).toEqual(['理解一个观点']);
  expect(JSON.stringify(request.messages)).not.toMatch(
    /FUTURE_CHAPTER_SENTINEL|OFF_PAGE_SENTINEL|需要先找到/,
  );
  await screen.findByRole('link', { name: /^Open source passage/ });
  fireEvent.click(screen.getByRole('button', { name: 'Remove reading source' }));
  await screen.findByRole('button', { name: 'Use book text' });
  await ask('现在普通聊天');
  expect(f.toolComplete).toHaveBeenCalledTimes(1);
  expect(
    f.complete.mock.calls
      .map(([request]) => request as CompletionRequest)
      .some((plain) => plain.messages.some((message) => message.content === '现在普通聊天')),
  ).toBe(true);
});

it('previews and explicitly attaches one chapter passage in a narrow window without calling a model', async () => {
  const { book, bookDoc } = await setup();
  await page.viewport(640, 480);
  const sidebar = screen.getByTestId('harness-sidebar');
  sidebar.style.width = '320px';
  sidebar.style.height = '480px';
  fireEvent.click(screen.getByRole('button', { name: 'Choose reading range' }));
  fireEvent.change(screen.getByRole('combobox', { name: 'Choose a chapter' }), {
    target: { value: listChapters(bookDoc)[0]!.id },
  });
  const chooser = await screen.findByRole('combobox', { name: 'Choose a passage' });
  const firstOption = chooser.querySelectorAll('option')[1]!;
  fireEvent.change(chooser, { target: { value: firstOption.value } });
  await screen.findByRole('button', { name: 'Use this passage' });
  expect((await loadConversations(book.hash))?.sessions[0]?.readingScope).toBeUndefined();
  expect(f.complete).not.toHaveBeenCalled();
  expect(f.toolComplete).not.toHaveBeenCalled();
  expect(sidebar.scrollWidth).toBeLessThanOrEqual(320);
  const sendBounds = screen.getByRole('button', { name: 'Send message' }).getBoundingClientRect();
  expect(sendBounds.top).toBeGreaterThan(0);
  expect(sendBounds.bottom).toBeLessThanOrEqual(480);
  await page.screenshot({ path: '../../../../../.glossa-dev/qa/harness/passage-picker-320.png' });
  fireEvent.click(screen.getByRole('button', { name: 'Use this passage' }));
  await waitFor(async () =>
    expect((await loadConversations(book.hash))?.sessions[0]?.readingScope?.kind).toBe('passage'),
  );
  const attached = (await loadConversations(book.hash))!.sessions[0]!.readingScope!;
  expect(attached.sources[1]!.text).toBe(firstParagraph);
  expect(JSON.stringify(attached)).not.toMatch(/OFF_PAGE_SENTINEL|FUTURE_CHAPTER_SENTINEL/);
  expect(f.complete).not.toHaveBeenCalled();
  expect(f.toolComplete).not.toHaveBeenCalled();
});

it('browses citations in answer order and keeps previews inside narrow, dark and e-ink viewports', async () => {
  const { book } = await setup();
  fireEvent.click(screen.getByRole('button', { name: 'Use book text' }));
  await screen.findByRole('button', { name: 'Current page' });
  let secondPassage = '';
  f.toolComplete.mockImplementation(async (request: ToolCompletionRequest) => {
    const evidence = JSON.parse(request.messages[1]!.content!).sources as {
      sourceId: string;
      text: string;
    }[];
    const paragraph = evidence.find((source) => source.text === firstParagraph)!;
    const second = evidence.find((source) => source.sourceId !== paragraph.sourceId)!;
    secondPassage = second.text;
    const text = `理解观点需要找出它回应的问题。[9](#source-${paragraph.sourceId})\n\n这里也谈到其他理解线索。[8](#source-${second.sourceId})\n\n理由用来支持结论。[4](#source-${paragraph.sourceId})`;
    request.onDelta?.(text);
    return { text, toolCalls: [] };
  });
  await ask('这章的主题和理解方法是什么？');
  expect(
    (await screen.findAllByRole('link', { name: /^Open source passage/ })).map(
      (link) => link.textContent,
    ),
  ).toEqual(['1', '2', '1']);
  await view!.goTo('two.xhtml');
  const origin = view!.lastLocation!.cfi!;
  for (const [theme, width, eink, dir] of [
    ['default-light', 420, false, 'ltr'],
    ['default-dark', 320, false, 'ltr'],
    ['default-dark', 320, false, 'rtl'],
    ['default-light', 320, true, 'rtl'],
  ] as const) {
    await page.viewport(width, 660);
    const sidebar = screen.getByTestId('harness-sidebar');
    sidebar.style.width = `${width}px`;
    sidebar.style.height = '660px';
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.setAttribute('data-eink', String(eink));
    document.documentElement.dir = dir;
    const citation = screen.getAllByRole('link', { name: 'Open source passage 1' })[0]!;
    fireEvent.focusIn(citation);
    const preview = await screen.findByRole('tooltip');
    await waitFor(() => expect(preview.querySelector('[role="status"]')).toBeNull());
    const bounds = preview.getBoundingClientRect();
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(width);
    expect(bounds.bottom).toBeLessThanOrEqual(660);
    expect(preview.scrollWidth).toBeLessThanOrEqual(preview.clientWidth);
    expect(sidebar.scrollWidth).toBeLessThanOrEqual(width);
    expect(view!.lastLocation?.cfi).toBe(origin);
    await page.screenshot({
      path: `../../../../../.glossa-dev/qa/citations/preview-${theme}-${width}-${eink ? 'eink' : dir}.png`,
    });
    fireEvent.keyDown(citation, { key: 'Escape' });
  }
  fireEvent.click(screen.getByRole('link', { name: 'Open source passage 2' }));
  await screen.findByText('2/2');
  const excerpt = screen.getByRole('complementary', { name: 'Source excerpt' });
  await waitFor(() => expect(excerpt.querySelector('blockquote')?.textContent).toBe(secondPassage));
  const previous = screen.getByRole('button', { name: 'Previous passage' });
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Back to reading position' }).hasAttribute('disabled'),
    ).toBe(false),
  );
  fireEvent.click(previous);
  await waitFor(() =>
    expect(excerpt.querySelector('blockquote')?.textContent).toBe(firstParagraph),
  );
  await screen.findByText('1/2');
  const back = screen.getByRole('button', { name: 'Back to reading position' });
  await waitFor(() => expect(back.hasAttribute('disabled')).toBe(false));
  fireEvent.click(back);
  await waitFor(() => expect(view!.lastLocation?.cfi).toBe(origin));
  expect(f.toolComplete).toHaveBeenCalledTimes(1);
  expect(
    (await loadConversations(book.hash))!.sessions[0]!.readingScope!.sources.length,
  ).toBeGreaterThan(1);
});
