import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { zipSync, strToU8 } from 'fflate';
import { DocumentLoader } from '@/libs/document';
import type { FoliateView } from '@/types/view';
import { extractChapter, listChapters } from '@/glossa/context/chapters';
import { buildReadingPassages } from '@/glossa/guide/passages';
import { loadMindmap } from '@/glossa/mindmap/store';
import type { CompletionRequest, ProviderConfig } from '@/glossa/ai/provider';
import MindmapPanel from '@/glossa/ui/MindmapPanel';
import '@/styles/globals.css';
import '@/styles/glossa.css';

const f = vi.hoisted(() => ({
  complete: vi.fn(),
  goTo: vi.fn(),
  progress: { sectionHref: 'one.xhtml', location: '' },
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
vi.mock('@/store/readerStore', () => {
  const readerView = {
    goTo: f.goTo,
    get lastLocation() {
      return view?.lastLocation;
    },
  };
  return {
    useReaderStore: {
      getState: () => ({
        getProgress: () => f.progress,
        getView: () => readerView,
      }),
    },
  };
});
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: {
    getState: () => ({
      setSettingsDialogBookKey: vi.fn(),
      setRequestedPanel: vi.fn(),
      setSettingsDialogOpen: vi.fn(),
    }),
  },
}));
vi.mock('@/glossa/ai/provider', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/glossa/ai/provider')>();
  return {
    ...original,
    getActiveProviderConfig: () => f.config,
    getProviderStatus: async () => ({ configured: true, hasApiKey: false, storage: 'session' }),
    validateProviderConfig: (value: ProviderConfig) => value,
    streamCompletion: f.complete,
  };
});
vi.mock('@/glossa/context/chapters', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/glossa/context/chapters')>();
  return { ...original, extractChapter: vi.fn(original.extractChapter) };
});

let view: FoliateView | undefined;
let motionStyle: HTMLStyleElement | undefined;
beforeEach(() => {
  vi.clearAllMocks();
  f.complete.mockReset();
  f.goTo.mockReset();
  f.progress.location = '';
});
afterEach(() => {
  cleanup();
  view?.close();
  view?.remove();
  view = undefined;
  motionStyle?.remove();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-eink');
  document.documentElement.removeAttribute('dir');
});

// The EPUB bytes and model responses are original fixtures; no user books or model service.
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

const explanation = '理解观点，先找到问题，再观察理由如何支持结论。';
function responseFor(request: CompletionRequest): string {
  const text = request.messages.find((message) => message.role === 'user')!.content;
  expect(text).not.toContain('FUTURE_CHAPTER_SENTINEL');
  expect(text).not.toContain('ADJACENT_PASSAGE_SENTINEL');
  const payload = JSON.parse(text) as { sources: { sourceId: string; text: string }[] };
  const idea = payload.sources.find((s) => s.text.startsWith('理解一个观点'))!.sourceId;
  const example = payload.sources.find((s) => s.text.startsWith('例子使'))!.sourceId;
  const response = JSON.stringify({
    nodes: [
      {
        id: 'root',
        parentId: null,
        label: '怎样理解一个观点',
        relation: '',
        explanation,
        sourceIds: [idea],
        kind: 'source',
      },
      {
        id: 'question',
        parentId: 'root',
        label: '它回答了什么问题',
        relation: '首先辨认',
        explanation: '找到观点要回答的问题。',
        sourceIds: [idea],
        kind: 'source',
      },
      {
        id: 'reason',
        parentId: 'root',
        label: '作者给出的理由',
        relation: '然后观察',
        explanation: '理由说明为什么可以接受这个判断。',
        sourceIds: [idea],
        kind: 'source',
      },
      {
        id: 'example',
        parentId: 'reason',
        label: '具体例子',
        relation: '具体化为',
        explanation: '例子让抽象的理由变得具体。',
        sourceIds: [example],
        kind: 'source',
      },
      {
        id: 'limit',
        parentId: 'example',
        label: '例子的适用条件',
        relation: '说明范围受限于',
        explanation: '不能把一个例子直接推广到所有情况。',
        sourceIds: [example],
        kind: 'inference',
      },
    ],
    insufficientEvidence: false,
  });
  request.onDelta?.(response);
  return response;
}

async function selectFirstPassage(chapterId: string) {
  fireEvent.change(screen.getByRole('combobox', { name: 'Chapter' }), {
    target: { value: chapterId },
  });
  await waitFor(() => expect(extractChapter).toHaveBeenCalled());
  const content = await vi.mocked(extractChapter).mock.results.at(-1)!.value;
  const passages = buildReadingPassages(content);
  expect(passages.length).toBeGreaterThanOrEqual(2);
  const passageSelect = await screen.findByRole('combobox', { name: 'Passage' });
  expect((passageSelect as HTMLSelectElement).value).toBe('');
  fireEvent.change(passageSelect, { target: { value: passages[0]!.id } });
  await waitFor(() =>
    expect(
      screen
        .getByRole('button', { name: /^(Generate|Regenerate) mind map$/, hidden: true })
        .hasAttribute('disabled'),
    ).toBe(false),
  );
  return {
    passage: passages[0]!,
    generate: screen.getByRole('button', {
      name: /^(Generate|Regenerate) mind map$/,
      hidden: true,
    }),
  };
}

it('maps a real selected EPUB passage, restores locally and verifies source/return in responsive layouts', async () => {
  await page.viewport(1160, 900);
  document.documentElement.setAttribute('data-theme', 'default-light');
  const { book, doc, chapters } = await fixture();
  f.complete.mockImplementation(async (request: CompletionRequest) => responseFor(request));
  const panel = render(
    <div
      data-testid='map-sidebar'
      className='bg-base-200'
      style={{ width: 390, height: 900, overflowY: 'auto', position: 'absolute', right: 0, top: 0 }}
    >
      <MindmapPanel book={book} bookDoc={doc} bookKey={book.hash} />
    </div>,
  );
  const sidebar = screen.getByTestId('map-sidebar');
  const chapterSelect = await screen.findByRole('combobox', { name: 'Chapter' });
  expect((chapterSelect as HTMLSelectElement).value).toBe('');
  expect(extractChapter).not.toHaveBeenCalled();
  expect(f.complete).not.toHaveBeenCalled();
  const { passage, generate } = await selectFirstPassage(chapters[0]!.id);
  fireEvent.click(generate);
  await screen.findByText('Mind map saved on this device.');
  const map = (await loadMindmap(book.hash, chapters[0]!.id, passage.id))!;
  expect(map.nodes).toHaveLength(5);
  expect(map.sources.every((source) => !source.text.includes('SENTINEL'))).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Expand all' }));
  expect(screen.getByRole('button', { name: '例子的适用条件' })).toBeTruthy();

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
  await view.open(doc);
  view.renderer.setAttribute('max-column-count', '1');
  const returnSource = map.sources.find((source) => source.text.startsWith('例子使'))!;
  await view.goTo(returnSource.anchor.cfi);
  f.progress.location = returnSource.anchor.cfi;
  f.goTo.mockImplementation((cfi: string) => view!.goTo(cfi));
  const expectedSource = map.sources.find((source) => source.text.startsWith('理解一个观点'))!;
  fireEvent.click(screen.getByRole('button', { name: '怎样理解一个观点' }));
  await waitFor(() => expect(f.goTo).toHaveBeenLastCalledWith(expectedSource.anchor.cfi));
  expect(document.querySelector('.glossa-guide-reference')).toBeNull();
  expect(f.goTo).toHaveBeenLastCalledWith(expectedSource.anchor.cfi);
  const resolved = view.resolveCFI(expectedSource.anchor.cfi);
  const visible = view.renderer.getContents()[0]!;
  expect(resolved.anchor?.(visible.doc)?.toString()).toBe(expectedSource.text);
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Return to reading position' }).hasAttribute('disabled'),
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Return to reading position' }));
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Return to reading position' })).toBeNull(),
  );
  expect(f.goTo).toHaveBeenLastCalledWith(returnSource.anchor.cfi);

  sidebar.scrollTop = 0;
  expect(sidebar.scrollWidth).toBeLessThanOrEqual(390);
  await page.screenshot({ path: '../../../../../.glossa-dev/qa/mindmap-light.png' });
  document.documentElement.setAttribute('data-theme', 'default-dark');
  await page.screenshot({ path: '../../../../../.glossa-dev/qa/mindmap-dark.png' });
  view.style.display = 'none';
  sidebar.style.width = '280px';
  await page.viewport(280, 900);
  fireEvent.click(screen.getByRole('button', { name: 'Larger nodes' }));
  fireEvent.click(screen.getByRole('button', { name: 'Larger nodes' }));
  fireEvent.click(screen.getByRole('button', { name: 'Larger nodes' }));
  expect(sidebar.scrollWidth).toBeLessThanOrEqual(280);
  chapterSelect.focus();
  expect(getComputedStyle(chapterSelect).outlineStyle).toBe('solid');
  sidebar.scrollTop = 0;
  await page.screenshot({ path: '../../../../../.glossa-dev/qa/mindmap-narrow.png' });
  document.documentElement.setAttribute('data-theme', 'default-light');
  document.documentElement.dir = 'rtl';
  expect(getComputedStyle(sidebar).direction).toBe('rtl');
  expect(sidebar.scrollWidth).toBeLessThanOrEqual(280);
  await page.screenshot({ path: '../../../../../.glossa-dev/qa/mindmap-rtl.png' });
  document.documentElement.setAttribute('data-eink', 'true');
  expect(getComputedStyle(document.querySelector('.glossa-map-node')!).boxShadow).toBe('none');
  expect(getComputedStyle(document.querySelector('.glossa-map-node')!).borderTopWidth).toBe('1px');
  await page.screenshot({ path: '../../../../../.glossa-dev/qa/mindmap-eink.png' });
  panel.unmount();
  render(<MindmapPanel book={book} bookDoc={doc} bookKey={book.hash} />);
  await selectFirstPassage(chapters[0]!.id);
  await screen.findByRole('button', { name: '怎样理解一个观点' });
  expect(f.complete).toHaveBeenCalledTimes(1);
}, 30_000);
