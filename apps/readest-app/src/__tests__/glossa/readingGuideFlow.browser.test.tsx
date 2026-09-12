import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { zipSync, strToU8 } from 'fflate';
import { DocumentLoader } from '@/libs/document';
import type { FoliateView } from '@/types/view';
import { extractChapter, listChapters } from '@/glossa/context/chapters';
import { buildReadingPassages } from '@/glossa/guide/passages';
import { loadReadingGuide } from '@/glossa/guide/store';
import type { CompletionRequest, ProviderConfig } from '@/glossa/ai/provider';
import ReadingGuidePanel from '@/glossa/ui/ReadingGuidePanel';
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
  const sourceIds = payload.sources
    .filter((source) => source.text.startsWith('理解一个观点'))
    .map((source) => source.sourceId);
  expect(sourceIds).toHaveLength(1);
  const response = JSON.stringify({
    orientation: [{ text: explanation, sourceIds, kind: 'source' }],
    difficulties: [
      {
        title: '理由与结论有什么区别？',
        explanation: {
          text: '结论是作者希望你接受的判断，理由则说明为什么接受它。',
          sourceIds,
          kind: 'background',
        },
      },
    ],
    readingCue: {
      text: '回看第一段，分清作者要解释的问题与支持判断的理由。',
      sourceIds,
      kind: 'inference',
    },
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
  await waitFor(() => expect(passageSelect.hasAttribute('disabled')).toBe(false));
  expect((passageSelect as HTMLSelectElement).value).toBe('');
  fireEvent.change(passageSelect, { target: { value: passages[0]!.id } });
  const generate = await screen.findByRole('button', { name: /^(Generate|Regenerate) guide$/ });
  await waitFor(() => expect(generate.hasAttribute('disabled')).toBe(false));
  return { passage: passages[0]!, generate };
}

it('guides only the chosen passage, restores its cache and navigates real EPUB sources in all reading layouts', async () => {
  motionStyle = document.createElement('style');
  motionStyle.textContent = '* { transition: none !important; animation: none !important; }';
  document.head.append(motionStyle);
  await page.viewport(1160, 900);
  document.documentElement.setAttribute('data-theme', 'default-light');
  const { book, doc, chapters } = await fixture();
  f.complete.mockImplementation(async (request: CompletionRequest) => responseFor(request));
  const panel = render(
    <div
      data-testid='guide-sidebar'
      className='bg-base-200'
      style={{ width: 390, height: 900, overflowY: 'auto', position: 'absolute', right: 0, top: 0 }}
    >
      <ReadingGuidePanel book={book} bookDoc={doc} bookKey={book.hash} />
    </div>,
  );
  const sidebar = screen.getByTestId('guide-sidebar');
  const chapterSelect = await screen.findByRole('combobox', { name: 'Chapter' });
  expect((chapterSelect as HTMLSelectElement).value).toBe('');
  expect(getComputedStyle(chapterSelect).borderTopWidth).toBe('1px');
  expect(getComputedStyle(chapterSelect).borderTopStyle).toBe('solid');
  expect(extractChapter).not.toHaveBeenCalled();
  expect(f.complete).not.toHaveBeenCalled();
  const { passage, generate } = await selectFirstPassage(chapters[0]!.id);
  expect(extractChapter).toHaveBeenCalledTimes(1);
  expect(vi.mocked(extractChapter).mock.calls[0]![1].id).toBe(chapters[0]!.id);
  expect(f.complete).not.toHaveBeenCalled();
  fireEvent.click(generate);
  await screen.findByText(explanation);
  await waitFor(async () =>
    expect(await loadReadingGuide(book.hash, chapters[0]!.id, passage.id)).not.toBeNull(),
  );
  expect(f.complete).toHaveBeenCalledTimes(1);
  const guide = (await loadReadingGuide(book.hash, chapters[0]!.id, passage.id))!;
  expect(guide.sources.every((source) => !source.text.includes('SENTINEL'))).toBe(true);
  const difficulty = screen.getByText('理由与结论有什么区别？').closest('details')!;
  expect(difficulty.open).toBe(false);
  fireEvent.click(screen.getByText('理由与结论有什么区别？'));
  expect(difficulty.open).toBe(true);
  expect(screen.getByText('Background explanation')).toBeTruthy();

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
  const returnSource = guide.sources.find((source) => source.text.startsWith('例子使'))!;
  await view.goTo(returnSource.anchor.cfi);
  f.progress.location = returnSource.anchor.cfi;
  f.goTo.mockImplementation((cfi: string) => view!.goTo(cfi));
  expect(sidebar.scrollWidth).toBeLessThanOrEqual(390);
  await page.screenshot({ path: '../../../../../.glossa-dev/qa/reading-guide-light.png' });
  const expectedSource = guide.sources.find((source) => source.text.startsWith('理解一个观点'))!;
  const sourceNumber = guide.sources.indexOf(expectedSource) + 1;
  fireEvent.click(
    (await screen.findAllByRole('button', { name: `View source ${sourceNumber}` }))[0]!,
  );
  await screen.findByText('Verified in this book');
  expect(f.goTo).toHaveBeenLastCalledWith(expectedSource.anchor.cfi);
  const resolved = view.resolveCFI(expectedSource.anchor.cfi);
  const visible = view.renderer.getContents()[0]!;
  expect(resolved.anchor?.(visible.doc)?.toString()).toBe(expectedSource.text);
  fireEvent.click(screen.getByRole('button', { name: 'Return to reading position' }));
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Return to reading position' })).toBeNull(),
  );
  expect(f.goTo).toHaveBeenLastCalledWith(returnSource.anchor.cfi);
  document.documentElement.setAttribute('data-theme', 'default-dark');
  await page.screenshot({ path: '../../../../../.glossa-dev/qa/reading-guide-dark.png' });
  view.style.display = 'none';
  sidebar.style.width = '360px';
  sidebar.style.height = '844px';
  await page.viewport(360, 844);
  chapterSelect.focus();
  expect(document.activeElement).toBe(chapterSelect);
  expect(getComputedStyle(chapterSelect).outlineStyle).toBe('solid');
  expect(sidebar.scrollWidth).toBeLessThanOrEqual(360);
  expect(chapterSelect.getBoundingClientRect().height).toBeGreaterThanOrEqual(40);
  await page.screenshot({ path: '../../../../../.glossa-dev/qa/reading-guide-narrow.png' });
  sidebar.scrollTop = sidebar.scrollHeight;
  await page.screenshot({ path: '../../../../../.glossa-dev/qa/reading-guide-narrow-detail.png' });
  sidebar.scrollTop = 0;
  document.documentElement.setAttribute('data-theme', 'default-light');
  document.documentElement.dir = 'rtl';
  expect(getComputedStyle(sidebar).direction).toBe('rtl');
  expect(getComputedStyle(difficulty.querySelector('summary')!).direction).toBe('ltr');
  expect(
    getComputedStyle(screen.getByRole('article', { name: 'Generated guide' }).querySelector('p')!)
      .direction,
  ).toBe('ltr');
  await page.screenshot({ path: '../../../../../.glossa-dev/qa/reading-guide-rtl.png' });
  document.documentElement.setAttribute('data-eink', 'true');
  expect(sidebar.scrollWidth).toBeLessThanOrEqual(360);
  expect(getComputedStyle(chapterSelect).boxShadow).toBe('none');
  expect(getComputedStyle(chapterSelect).borderTopWidth).toBe('1px');
  expect(getComputedStyle(chapterSelect).borderTopStyle).toBe('solid');
  await page.screenshot({ path: '../../../../../.glossa-dev/qa/reading-guide-eink.png' });

  panel.unmount();
  render(<ReadingGuidePanel book={book} bookDoc={doc} bookKey={book.hash} />);
  const reopenedChapter = await screen.findByRole('combobox', { name: 'Chapter' });
  expect((reopenedChapter as HTMLSelectElement).value).toBe('');
  expect(extractChapter).toHaveBeenCalledTimes(1);
  await selectFirstPassage(chapters[0]!.id);
  await screen.findByText(explanation);
  expect(f.complete).toHaveBeenCalledTimes(1);
}, 30_000);

it('cancels an in-flight guide without saving it and retries only the same selected passage', async () => {
  const { book, doc, chapters } = await fixture();
  f.complete.mockImplementationOnce(
    (request: CompletionRequest) =>
      new Promise<string>((_resolve, reject) => {
        request.onDelta?.('{"orientation":');
        request.signal!.addEventListener(
          'abort',
          () => reject(new DOMException('Cancelled', 'AbortError')),
          {
            once: true,
          },
        );
      }),
  );
  f.complete.mockImplementation(async (request: CompletionRequest) => responseFor(request));
  render(<ReadingGuidePanel book={book} bookDoc={doc} bookKey={book.hash} />);
  await screen.findByRole('combobox', { name: 'Chapter' });
  const { passage, generate } = await selectFirstPassage(chapters[0]!.id);
  fireEvent.click(generate);
  await waitFor(() => expect(f.complete).toHaveBeenCalledTimes(1));
  fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(f.complete.mock.calls[0]![0].signal.aborted).toBe(true));
  expect(await loadReadingGuide(book.hash, chapters[0]!.id, passage.id)).toBeNull();
  expect(screen.queryByText(explanation)).toBeNull();
  const retry = await screen.findByRole('button', { name: 'Generate guide' });
  await waitFor(() => expect(retry.hasAttribute('disabled')).toBe(false));
  fireEvent.click(retry);
  await screen.findByText(explanation);
  await waitFor(async () =>
    expect(await loadReadingGuide(book.hash, chapters[0]!.id, passage.id)).not.toBeNull(),
  );
  expect(f.complete).toHaveBeenCalledTimes(2);
  expect(extractChapter).toHaveBeenCalledTimes(1);
}, 15_000);
