import { afterEach, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { DocumentLoader } from '@/libs/document';
import type { FoliateView } from '@/types/view';
import { extractChapter, listChapters } from '@/glossa/context/chapters';
import { resolveSource } from '@/glossa/citations/sources';

let view: FoliateView | undefined;
afterEach(() => {
  view?.close();
  view?.remove();
  view = undefined;
});

it('opens a generated note citation in the real EPUB renderer at its original paragraph', async () => {
  const entries = {
    mimetype: 'application/epub+zip',
    'META-INF/container.xml':
      '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    'content.opf':
      '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">glossa-note-synthetic</dc:identifier><dc:title>章节定位测试</dc:title><dc:language>zh</dc:language></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="one"/></spine></package>',
    'nav.xhtml':
      '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>目录</title></head><body><nav epub:type="toc"><ol><li><a href="one.xhtml#one">第一节</a></li><li><a href="one.xhtml#two">第二节</a></li></ol></nav></body></html>',
    'one.xhtml':
      '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>测试章节</title></head><body><h1 id="one">第一节</h1><p>本节解释制度的形成。</p><h1 id="two">第二节</h1><p id="evidence">原文证据保留在阅读器中，笔记可以定位到这一段。</p></body></html>',
  };
  const bytes = zipSync(
    Object.fromEntries(Object.entries(entries).map(([path, text]) => [path, strToU8(text)])),
  );
  const { book } = await new DocumentLoader(
    new File([new Uint8Array(bytes)], 'notes-synthetic.epub', { type: 'application/epub+zip' }),
  ).open();
  const content = await extractChapter(book, listChapters(book)[1]!);
  expect(content.sources).toHaveLength(2);
  const source = content.sources[1]!;
  const resolved = await resolveSource(book, source);
  expect(resolved?.recovered).toBe(false);

  await import('foliate-js/view.js');
  await import('foliate-js/paginator.js');
  view = document.createElement('foliate-view') as FoliateView;
  Object.assign(view.style, {
    width: '800px',
    height: '600px',
    position: 'absolute',
    left: '0',
    top: '0',
  });
  document.body.append(view);
  await view.open(book);
  await view.goTo(resolved!.cfi);
  const visible = view.renderer
    .getContents()
    .find((content) => content.index === source.anchor.sectionIndex);
  expect(visible).toBeDefined();
  const target = view.resolveCFI(resolved!.cfi);
  const range = target.anchor?.(visible!.doc);
  expect(range?.toString()).toBe(source.text);
  expect(range?.startContainer.parentElement?.id).toBe('evidence');
}, 30_000);
