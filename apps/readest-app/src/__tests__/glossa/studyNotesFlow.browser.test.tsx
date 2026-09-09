import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { zipSync, strToU8 } from 'fflate';
import { DocumentLoader } from '@/libs/document';
import type { FoliateView } from '@/types/view';
import { extractChapter, listChapters } from '@/glossa/context/chapters';
import { loadChapterNotes, deleteStudyNote } from '@/glossa/notes/store';
import type { CompletionRequest, ProviderConfig } from '@/glossa/ai/provider';
import StudyNotesPanel from '@/glossa/ui/StudyNotesPanel';
const zh: Record<string, string> = await (await fetch('/locales/zh-CN/translation.json')).json();
import '@/styles/globals.css';
import '@/styles/glossa.css';

const f = vi.hoisted(() => ({
  complete: vi.fn(),
  goTo: vi.fn(),
  progress: { sectionHref: 'one.xhtml#one', location: '' },
  config: {
    id: 'fixture',
    name: '本地测试服务',
    baseUrl: 'http://localhost:1234/v1',
    model: 'fixture-model',
  },
}));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, values?: Record<string, string | number>) =>
    ((zh as Record<string, string>)[key] || key).replace(/{{(\w+)}}/g, (_, name: string) =>
      String(values?.[name] ?? name),
    ),
}));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: { saveFile: vi.fn() } }) }));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: {
    getState: () => ({ getProgress: () => f.progress, getView: () => ({ goTo: f.goTo }) }),
  },
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
vi.mock('@/glossa/ai/provider', () => ({
  getActiveProviderConfig: () => f.config,
  getProviderStatus: async () => ({ configured: true, hasApiKey: false, storage: 'session' }),
  validateProviderConfig: (value: ProviderConfig) => value,
  streamCompletion: f.complete,
}));

let view: FoliateView | undefined;
let bookId = '';
let chapterId = '';
afterEach(async () => {
  cleanup();
  view?.close();
  view?.remove();
  if (bookId && chapterId) {
    for (const version of (await loadChapterNotes(bookId, chapterId)).versions)
      await deleteStudyNote(version.id);
  }
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-eink');
  document.documentElement.removeAttribute('dir');
});

it('generates, persists and reopens a sourced note beside the real EPUB renderer', async () => {
  await page.viewport(1100, 900);
  document.documentElement.setAttribute('data-theme', 'default-light');
  const files = {
    mimetype: 'application/epub+zip',
    'META-INF/container.xml':
      '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    'content.opf':
      '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">notes-flow</dc:identifier><dc:title>阅读与理解 · 原创测试材料</dc:title><dc:language>zh</dc:language></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="one"/></spine></package>',
    'nav.xhtml':
      '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>目录</title></head><body><nav epub:type="toc"><ol><li><a href="one.xhtml#one">第一章　如何理解一个观点</a></li><li><a href="one.xhtml#two">第二章　继续阅读</a></li></ol></nav></body></html>',
    'one.xhtml':
      '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>理解一个观点</title><style>body{font-family:serif;padding:36px;line-height:2.1;color:#282828}h1{font-size:24px}p{font-size:19px}</style></head><body><h1 id="one">第一章　如何理解一个观点</h1><p>理解一个观点，需要先找到它回答的问题，再观察作者给出的理由。结论提供方向，理由说明为什么可以朝这个方向思考。</p><p>例子使抽象的理由变得具体。但一个例子能够说明什么，仍然受到它的条件限制。因此，记录例子的同时，也需要记下这些条件。</p><h1 id="two">第二章　继续阅读</h1><p>这一章没有被选中，不应进入模型请求。</p></body></html>',
  };
  const bytes = zipSync(
    Object.fromEntries(Object.entries(files).map(([path, text]) => [path, strToU8(text)])),
  );
  const { book: doc } = await new DocumentLoader(
    new File([new Uint8Array(bytes)], 'notes-flow.epub'),
  ).open();
  const chapter = listChapters(doc)[0]!;
  const content = await extractChapter(doc, chapter);
  expect(content.sources.some((source) => source.text.includes('没有被选中'))).toBe(false);
  bookId = `flow-${crypto.randomUUID()}`;
  chapterId = chapter.id;
  await import('foliate-js/view.js');
  await import('foliate-js/paginator.js');
  view = document.createElement('foliate-view') as FoliateView;
  Object.assign(view.style, {
    width: '700px',
    height: '900px',
    position: 'absolute',
    left: '390px',
    top: '0',
  });
  document.body.append(view);
  await view.open(doc);
  await view.goTo(content.sources[0]!.anchor.cfi);
  f.progress.location = content.sources[0]!.anchor.cfi;
  f.goTo.mockImplementation((cfi: string) => view!.goTo(cfi));
  f.complete.mockImplementation(async (request: CompletionRequest) => {
    expect(request.messages[1]!.content).not.toContain('没有被选中');
    const sources = JSON.parse(request.messages[1]!.content).sources as {
      sourceId: string;
      text: string;
    }[];
    const ids = sources
      .filter((source) => !source.text.startsWith('第一章'))
      .map((source) => source.sourceId);
    const response = JSON.stringify({
      title: '从问题出发，理解论证',
      overview: [
        {
          text: '理解观点的关键，是把问题、结论与理由联系起来，并保留例子成立的条件。',
          sourceIds: ids,
          kind: 'source',
        },
      ],
      sections: [
        {
          heading: '先找问题，再看理由',
          paragraphs: [
            {
              text: '记录结论之后，还需要说明作者怎样为结论提供理由。这样，笔记保存的就不仅是观点的名称，也包括能够重新走一遍的思考过程。',
              sourceIds: [ids[0]],
              kind: 'inference',
            },
          ],
        },
        {
          heading: '例子与适用条件一起保留',
          paragraphs: [
            {
              text: '例子帮助读者理解抽象理由，但它能够支持什么，取决于具体条件。读到例子时应同时记录这些条件，避免把局部说明当作普遍结论。',
              sourceIds: [ids[1]],
              kind: 'source',
            },
          ],
        },
      ],
      questions: [
        {
          question: '为什么笔记不应只保留结论？',
          answer: '因为理解一个观点，还需要找到它回答的问题，以及支持结论的理由。',
          sourceIds: [ids[0]],
        },
      ],
      insufficientEvidence: false,
    });
    request.onDelta?.(response);
    return response;
  });
  const book = {
    hash: bookId,
    title: '阅读与理解',
    author: '原创测试',
    format: 'EPUB' as const,
    createdAt: 1,
    updatedAt: 1,
  };
  const panel = render(
    <div style={{ width: 370, height: 900, overflowY: 'auto' }} className='bg-base-200'>
      <StudyNotesPanel book={book} bookDoc={doc} bookKey={bookId} />
    </div>,
  );
  const generate = await screen.findByRole('button', { name: zh['Generate study note'] });
  await waitFor(() => expect(generate.hasAttribute('disabled')).toBe(false));
  fireEvent.click(generate);
  await screen.findByRole('heading', { name: '从问题出发，理解论证' });
  expect((await loadChapterNotes(bookId, chapterId)).versions).toHaveLength(1);
  expect(getComputedStyle(panel.container.querySelector('.glossa-study-input')!).borderRadius).toBe(
    '12px',
  );
  expect(getComputedStyle(panel.container.querySelector('.glossa-button')!).display).toBe(
    'inline-flex',
  );
  await page.screenshot({ path: '../../../../../.glossa-dev/qa/study-light.png' });
  const firstRef = (
    await screen.findAllByRole('button', {
      name: zh['View source {{number}}']!.replace('{{number}}', '2'),
    })
  )[0]!;
  fireEvent.click(firstRef);
  await screen.findByText(zh['Original source']!);
  expect(f.goTo).toHaveBeenCalledWith(content.sources[1]!.anchor.cfi);
  const resolved = view.resolveCFI(content.sources[1]!.anchor.cfi);
  const visible = view.renderer.getContents()[0]!;
  expect(resolved.anchor?.(visible.doc)?.toString()).toBe(content.sources[1]!.text);
  document.documentElement.setAttribute('data-theme', 'default-dark');
  await page.screenshot({ path: '../../../../../.glossa-dev/qa/study-dark.png' });
  document.documentElement.setAttribute('data-theme', 'default-light');
  document.documentElement.setAttribute('data-eink', 'true');
  document.documentElement.dir = 'rtl';
  await page.viewport(390, 844);
  view.style.display = 'none';
  expect(panel.container.querySelector('.glossa-study-panel')!.scrollWidth).toBeLessThanOrEqual(
    370,
  );
  await page.screenshot({ path: '../../../../../.glossa-dev/qa/study-narrow.png' });
  panel.unmount();
  render(<StudyNotesPanel book={book} bookDoc={doc} bookKey={bookId} />);
  await screen.findByRole('heading', { name: '从问题出发，理解论证' });
  expect(f.complete).toHaveBeenCalledTimes(1);
}, 30_000);
