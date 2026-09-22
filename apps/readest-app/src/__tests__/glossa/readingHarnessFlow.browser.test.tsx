import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { zipSync, strToU8 } from 'fflate';
import { DocumentLoader } from '@/libs/document';
import { normalizeSourceText } from '@/glossa/context/text';
import type { FoliateView } from '@/types/view';
import {
  ModelServiceError,
  type CompletionRequest,
  type ToolCompletionRequest,
} from '@/glossa/ai/provider';
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
  f.toolComplete.mockImplementation(async (request: ToolCompletionRequest) => ({
    text: await f.complete(request),
    toolCalls: [],
  }));
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
    'one.xhtml': `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>理解与理由</title><style>body{font-family:serif;padding:40px;line-height:2.1}h1{font-size:26px}p{font-size:22px}</style></head><body><h1>第一章　理解与理由</h1><p id="first">${firstParagraph}</p>${Array.from({ length: 22 }, (_, i) => `<p>第${i + 1}个例子帮助我们观察条件。一个例子能够说明什么，受到这些条件限制。记录例子的同时，也应当记录条件。</p>`).join('')}<h2>稍后的讨论</h2><p>OFF_PAGE_SENTINEL：这是稍后的讨论材料。</p></body></html>`,
    'two.xhtml':
      '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>比较与应用</title></head><body><h1>第二章　比较与应用</h1><p>FUTURE_CHAPTER_SENTINEL：另一章的比较与应用材料。</p></body></html>',
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
  await screen.findByRole('switch', { name: 'Citations', checked: true });
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

it('uses whole-book access by default and restores a verified citation from a later chapter', async () => {
  const { book, panel, wrapper } = await setup();
  expect(f.complete).not.toHaveBeenCalled();
  const origin = view!.lastLocation!.cfi;
  let usedId = '';
  f.complete.mockImplementation(async (request: CompletionRequest) => {
    if (request.messages[0]!.content.startsWith('Name this conversation')) return '';
    if (request.messages[0]!.content.startsWith('Plan a reading request'))
      return JSON.stringify({
        strategy: 'search',
        chapterIds: [],
        queries: ['FUTURE_CHAPTER_SENTINEL'],
      });
    const data = JSON.parse(request.messages[1]!.content) as {
      sources: { sourceId: string; text: string }[];
    };
    usedId = data.sources.find((source) =>
      source.text.includes('FUTURE_CHAPTER_SENTINEL'),
    )!.sourceId;
    const text = `后章有比较的材料。[1](#source-${usedId})`;
    request.onDelta?.(text);
    return text;
  });
  await ask('后章有哪些比较材料？');
  expect(f.toolComplete).toHaveBeenCalledOnce();
  expect(view!.lastLocation!.cfi).toBe(origin);
  await waitFor(async () =>
    expect((await loadConversations(book.hash))?.sessions[0]?.turns).toHaveLength(1),
  );
  const saved = currentAnswerVersion((await loadConversations(book.hash))!.sessions[0]!.turns[0]!);
  expect(saved.reading?.scope.kind).toBe('book');
  expect(saved.reading?.scope.sources).toEqual([]);
  expect(
    saved.reading?.sources.find((source) => source.sourceId === usedId)?.anchor.sectionIndex,
  ).toBe(1);
  panel.unmount();
  render(wrapper());
  const citation = await screen.findByRole('link', { name: /^Open source passage/ });
  fireEvent.mouseEnter(citation);
  const tooltip = await screen.findByRole('tooltip');
  await waitFor(() => expect(tooltip.textContent).toContain('FUTURE_CHAPTER_SENTINEL'));
  expect(view!.lastLocation!.cfi).toBe(origin);
  fireEvent.click(citation);
  await waitFor(() => expect(view!.resolveCFI(view!.lastLocation!.cfi!).index).toBe(1));
  const back = await screen.findByRole('button', { name: 'Back to reading position' });
  await waitFor(() => expect(back.hasAttribute('disabled')).toBe(false));
  fireEvent.click(back);
  await waitFor(() => expect(view!.lastLocation!.cfi).toBe(origin));
  await page.screenshot({
    path: '../../../../../.glossa-dev/qa/harness/whole-book-conversation.png',
  });
});

it('keeps streamed text visible during recovery and restores both halves with verified citations', async () => {
  const { book, panel, wrapper } = await setup();
  let requests = 0;
  let finish: (() => void) | undefined;
  f.complete.mockImplementation(async (request: CompletionRequest) => {
    if (request.messages[0]!.content.startsWith('Name this conversation')) return '';
    const sources = JSON.parse(request.messages[1]!.content).sources as {
      sourceId: string;
      text: string;
    }[];
    const id = sources.find((source) => source.text === firstParagraph)!.sourceId;
    if (++requests === 1) {
      request.onDelta?.(`先找问题。[1](#source-${id})`);
      throw new ModelServiceError('cut short', 'length');
    }
    return new Promise<string>((resolve) => {
      finish = () => {
        const rest = `再看理由。[1](#source-${id})`;
        request.onDelta?.(rest);
        resolve(rest);
      };
    });
  });
  fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), {
    target: { value: '理解观点为什么需要理由？' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  expect(document.body.textContent).toContain('先找问题。');
  expect(screen.getByRole('button', { name: 'Stop reply' })).toBeTruthy();
  finish!();
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Stop reply' })).toBeNull());
  await waitFor(async () =>
    expect((await loadConversations(book.hash))?.sessions[0]?.turns).toHaveLength(1),
  );
  const answer = currentAnswerVersion((await loadConversations(book.hash))!.sessions[0]!.turns[0]!);
  expect(requests).toBe(2);
  expect(answer.status).toBe('complete');
  expect(answer.text).toContain('先找问题。');
  expect(answer.text).toContain('再看理由。');
  panel.unmount();
  render(wrapper());
  const citations = await screen.findAllByRole('link', { name: /^Open source passage/ });
  fireEvent.mouseEnter(citations[0]!);
  const tooltip = await screen.findByRole('tooltip');
  await waitFor(() => expect(tooltip.textContent).toContain(firstParagraph));
  await page.screenshot({
    path: '../../../../../.glossa-dev/qa/harness/recovered-book-conversation.png',
  });
});

it.each([
  'canonical',
  'direct',
] as const)('restores a real EPUB snapshot and previews %s citations with verified return navigation', async (format) => {
  const { book, panel, wrapper } = await setup();
  expect(f.complete).not.toHaveBeenCalled();
  expect(f.toolComplete).not.toHaveBeenCalled();
  let sourceId = '';
  f.toolComplete.mockImplementation(async (request: ToolCompletionRequest) => {
    const results = request.messages.filter((message) => message.role === 'tool');
    if (!results.length)
      return call('search_book', { queries: ['作者给出的理由'], chapterIds: [] });
    if (results.length === 1) {
      const { chapters } = JSON.parse(request.messages[1]!.content!);
      return call('read_chapter', { chapterId: chapters[0].id, query: '', offset: 0 });
    }
    sourceId = JSON.parse(results[1]!.content).sources.find(
      (s: { text: string }) => s.text === firstParagraph,
    ).sourceId;
    const text = `作者建议先找问题，再核对理由如何支持结论。[原文](#${format === 'canonical' ? 'source-' : ''}${sourceId})\n\n**我的理解：** 把结论放回它回答的问题中，能更清楚地判断理由是否充分。`;
    request.onDelta?.(text);
    return { text, toolCalls: [] };
  });
  await ask('如何理解这段？');
  await screen.findByRole('link', { name: /^Open source passage/ });
  expect(f.toolComplete).toHaveBeenCalledTimes(3);
  const requests = f.toolComplete.mock.calls.map(([request]) => request as ToolCompletionRequest);
  expect(JSON.stringify(requests.map((request) => request.messages))).not.toMatch(/epubcfi/);
  expect(requests.at(-1)!.messages.filter((message) => message.role === 'tool')).toHaveLength(2);
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
  await screen.findByRole('switch', { name: 'Citations', checked: true });
  expect((await loadConversations(book.hash))!.sessions[0]!.readingScope).toBeUndefined();
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
  expect(screen.queryByRole('complementary', { name: 'Source excerpt' })).toBeNull();
  await waitFor(() => expect(view!.resolveCFI(view!.lastLocation!.cfi!).index).toBe(0));
  const sourceDocument = view!.renderer.getContents()[0]!.doc;
  const highlightWindow = sourceDocument.defaultView as Window & typeof globalThis;
  await waitFor(() => expect(highlightWindow.CSS.highlights.has('glossa-source')).toBe(true));
  expect(
    [...highlightWindow.CSS.highlights.get('glossa-source')!]
      .map((range) => range.toString())
      .join(''),
  ).toBe(firstParagraph);
  // Same-target navigation and a later pagination update must not erase emphasis.
  const highlightedRange = [...highlightWindow.CSS.highlights.get('glossa-source')!][0]!;
  if (!(highlightedRange instanceof highlightWindow.Range)) throw new Error('Missing range');
  const target = view!.getCFI(0, highlightedRange);
  for (let repeat = 0; repeat < 2; repeat++) {
    await view!.goTo(target);
    expect(highlightWindow.CSS.highlights.has('glossa-source')).toBe(true);
  }
  view!.dispatchEvent(new CustomEvent('relocate', { detail: view!.lastLocation }));
  expect(highlightWindow.CSS.highlights.has('glossa-source')).toBe(true);
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
    const toggle = screen.getByRole('switch', { name: 'Citations', checked: true });
    const model = screen.getByRole('button', { name: 'Choose model' });
    const send = screen.getByRole('button', { name: 'Send message' });
    const back = screen.getByRole('button', { name: 'Back to reading position' });
    const toggleRect = toggle.getBoundingClientRect();
    const modelRect = model.getBoundingClientRect();
    const sendRect = send.getBoundingClientRect();
    const returnRect = back.getBoundingClientRect();
    const iconRect = back.querySelector('svg')!.getBoundingClientRect();
    const composerRect = sidebar.querySelector('form')!.getBoundingClientRect();
    expect(toggle.textContent).toBe('');
    expect(Math.abs(toggleRect.y - sendRect.y)).toBeLessThan(1);
    expect(returnRect.bottom).toBeLessThan(composerRect.top);
    expect(
      Math.abs(iconRect.y + iconRect.height / 2 - returnRect.y - returnRect.height / 2),
    ).toBeLessThan(1);
    if (dir === 'ltr') {
      expect(toggleRect.right).toBeLessThan(modelRect.left);
      expect(modelRect.right).toBeLessThan(sendRect.left);
      expect(Math.abs(returnRect.right - composerRect.right)).toBeLessThan(1);
    } else {
      expect(sendRect.right).toBeLessThan(modelRect.left);
      expect(modelRect.right).toBeLessThan(toggleRect.left);
      expect(Math.abs(returnRect.left - composerRect.left)).toBeLessThan(1);
    }
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
  expect(f.toolComplete).toHaveBeenCalledTimes(3);
});

it('turns references off without reading book text and restores the choice', async () => {
  const { book, bookDoc, panel, wrapper } = await setup();
  const reads = bookDoc.sections.map((section) => vi.spyOn(section, 'createDocument'));
  fireEvent.click(screen.getByRole('switch', { name: 'Citations', checked: true }));
  await ask('这本书的思想可以怎么理解？');
  expect(f.toolComplete).not.toHaveBeenCalled();
  expect(reads.every((read) => read.mock.calls.length === 0)).toBe(true);
  const requests = f.complete.mock.calls.map(([request]) => request as CompletionRequest);
  expect(JSON.stringify(requests.map((r) => r.messages))).not.toMatch(
    /FUTURE_CHAPTER_SENTINEL|OFF_PAGE_SENTINEL|需要先找到/,
  );
  await waitFor(async () =>
    expect((await loadConversations(book.hash))?.sessions[0]?.citationsEnabled).toBe(false),
  );
  panel.unmount();
  render(wrapper());
  await screen.findByRole('switch', { name: 'Citations', checked: false });
  await page.viewport(640, 480);
  const sidebar = screen.getByTestId('harness-sidebar');
  sidebar.style.width = '320px';
  sidebar.style.height = '480px';
  expect(sidebar.scrollWidth).toBeLessThanOrEqual(320);
  expect(screen.queryByRole('combobox', { name: 'Choose a passage' })).toBeNull();
  await page.screenshot({ path: '../../../../../.glossa-dev/qa/harness/references-off-320.png' });
});

it('browses citations in answer order and keeps previews inside narrow, dark and e-ink viewports', async () => {
  const { book } = await setup();
  let secondPassage = '';
  f.toolComplete.mockImplementation(async (request: ToolCompletionRequest) => {
    const evidence = JSON.parse(request.messages[1]!.content!).sources as {
      sourceId: string;
      text: string;
    }[];
    const paragraph = evidence.find((source) => source.text === firstParagraph)!;
    const second = evidence.find((source) => source.sourceId !== paragraph.sourceId)!;
    secondPassage = second.text;
    const text = `理解观点需要找出它回应的问题[9](#source-${paragraph.sourceId})。\n\n这里也谈到其他理解线索。[8](#source-${second.sourceId})\n\n理由用来支持结论。[4](#source-${paragraph.sourceId})`;
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
    const punctuation = document.createRange();
    punctuation.selectNodeContents(citation.nextSibling!);
    const markBounds = punctuation.getBoundingClientRect();
    const citationBounds = citation.getBoundingClientRect();
    expect(markBounds.top).toBeLessThan(citationBounds.bottom);
    expect(markBounds.bottom).toBeGreaterThan(citationBounds.top);
    fireEvent.focusIn(citation);
    const preview = await screen.findByRole('tooltip');
    await waitFor(() => expect(preview.querySelector('[role="status"]')).toBeNull());
    expect(preview.querySelector('header')?.textContent).toContain('第一章');
    expect(preview.querySelector('header')?.textContent).not.toContain('第二章');
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
  const highlightedText = () => {
    const doc = view!.renderer.getContents().find((content) => content.index === 0)!.doc;
    const win = doc.defaultView as Window & typeof globalThis;
    return normalizeSourceText(
      [...(win.CSS.highlights.get('glossa-source') ?? [])]
        .map((range) => range.toString())
        .join(''),
    );
  };
  await waitFor(() => expect(highlightedText()).toBe(secondPassage));
  expect(screen.queryByRole('complementary', { name: 'Source excerpt' })).toBeNull();
  fireEvent.click(screen.getAllByRole('link', { name: 'Open source passage 1' })[0]!);
  await waitFor(() => expect(highlightedText()).toBe(firstParagraph));
  expect(screen.queryByRole('complementary', { name: 'Source excerpt' })).toBeNull();
  const back = screen.getByRole('button', { name: 'Back to reading position' });
  await waitFor(() => expect(back.hasAttribute('disabled')).toBe(false));
  fireEvent.click(back);
  await waitFor(() => expect(view!.lastLocation?.cfi).toBe(origin));
  expect(f.toolComplete).toHaveBeenCalledTimes(1);
  expect(
    currentAnswerVersion((await loadConversations(book.hash))!.sessions[0]!.turns[0]!).reading!
      .sources.length,
  ).toBeGreaterThan(1);
});

it('automatically reads the selection frozen at send time and ignores later page changes', async () => {
  const { bookDoc } = await setup();
  const doc = view!.renderer.getContents()[0]!.doc;
  const range = doc.createRange();
  range.setStart(doc.getElementById('first')!.firstChild!, 0);
  range.setEnd(doc.getElementById('first')!.firstChild!, 6);
  doc.getSelection()!.removeAllRanges();
  doc.getSelection()!.addRange(range);
  const { createEpubFocusReader } = await import('@/glossa/harness/epub');
  const read = createEpubFocusReader(bookDoc, view, 'focus-fixture');
  doc.getSelection()!.removeAllRanges();
  await view!.goTo('two.xhtml');
  expect((await read(new AbortController().signal)).map((s) => s.text)).toEqual(['理解一个观点']);
  await view!.goTo('one.xhtml');
  const current = view!.renderer.getContents()[0]!.doc;
  const selected = current.createRange();
  selected.setStart(current.getElementById('first')!.firstChild!, 0);
  selected.setEnd(current.getElementById('first')!.firstChild!, 6);
  current.getSelection()!.removeAllRanges();
  current.getSelection()!.addRange(selected);
  f.toolComplete.mockImplementation(async (request: ToolCompletionRequest) => {
    const { sources } = JSON.parse(request.messages[1]!.content!);
    expect(sources.map((s: { text: string }) => s.text)).toEqual(['理解一个观点']);
    return { text: `这里提出理解观点。[1](#source-${sources[0].sourceId})`, toolCalls: [] };
  });
  await ask('解释这段话');
  await screen.findByRole('link', { name: /^Open source passage/ });
  expect(f.toolComplete).toHaveBeenCalledOnce();
});
