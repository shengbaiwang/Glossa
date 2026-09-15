import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { CFI, DocumentLoader } from '@/libs/document';
import type { FoliateView } from '@/types/view';
import { goToAdjacentSection } from '@/app/reader/utils/sectionNav';
import Button from '@/components/Button';
import { findAdjacentTocItem } from '@/services/nav/lookup';

vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: null }) }));
let view: FoliateView | undefined;
afterEach(() => {
  cleanup();
  view?.close();
  view?.remove();
  view = undefined;
});

it('repeatedly long-presses forward and backward across real paginated chapter headings', async () => {
  const chapters = [1, 2, 3, 4];
  const entries = {
    mimetype: 'application/epub+zip',
    'META-INF/container.xml':
      '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    'content.opf':
      '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">chapter-press-test</dc:identifier><dc:title>Chapter test</dc:title><dc:language>en</dc:language></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="text" href="text.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="text"/></spine></package>',
    'nav.xhtml': `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol>${chapters.map((n) => `<li><a href="text.xhtml#ch${n}">Chapter ${n}</a></li>`).join('')}</ol></nav></body></html>`,
    'text.xhtml': `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapters</title><style>section { break-before: column; } p { font-size: 18px; }</style></head><body>${chapters.map((n) => `<section><p>Part ${n}</p><h1 id="ch${n}">Chapter ${n}</h1><p>${'A short original passage for testing chapter navigation. '.repeat(40)}</p></section>`).join('')}</body></html>`,
  };
  const bytes = zipSync(
    Object.fromEntries(Object.entries(entries).map(([path, text]) => [path, strToU8(text)])),
  );
  const { book } = await new DocumentLoader(
    new File([new Uint8Array(bytes)], 'chapter-test.epub', { type: 'application/epub+zip' }),
  ).open();
  await import('foliate-js/view.js');
  view = document.createElement('foliate-view') as FoliateView;
  Object.assign(view.style, {
    width: '800px',
    height: '600px',
    position: 'absolute',
    top: '0',
    left: '0',
  });
  document.body.append(view);
  await view.open(book);
  view.renderer.setAttribute('max-column-count', '1');
  await view.goTo(book.toc![0]!.href);
  expect(view.lastLocation?.tocItem?.label).toBe('Chapter 1');
  const doc = view.renderer.getContents()[0]!.doc;
  for (const [i, item] of book.toc!.entries()) {
    item.cfi = CFI.joinIndir(
      book.sections[0]!.cfi,
      CFI.fromElements([doc.getElementById(`ch${i + 1}`)!])[0]!,
    );
  }

  const onPage = vi.fn();
  let navigation: Promise<void> | undefined;
  const jump = (direction: 1 | -1) => {
    navigation = goToAdjacentSection(view!, view!.lastLocation?.cfi, direction);
  };
  render(
    <>
      <Button icon='Previous' label='Previous' onClick={onPage} onLongPress={() => jump(-1)} />
      <Button icon='Next' label='Next' onClick={onPage} onLongPress={() => jump(1)} />
    </>,
  );
  for (const [label, target] of [
    ['Next', 2],
    ['Next', 3],
    ['Next', 4],
    ['Previous', 3],
    ['Previous', 2],
  ] as const) {
    const button = screen.getByRole('button', { name: label });
    fireEvent.pointerDown(button, {
      pointerId: 1,
      button: 0,
      pointerType: 'mouse',
      clientX: 10,
      clientY: 10,
    });
    await new Promise((resolve) => setTimeout(resolve, 550));
    fireEvent.pointerUp(button, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.click(button);
    await navigation;
    await waitFor(() => expect(view!.lastLocation?.tocItem?.label).toBe(`Chapter ${target}`));
    if (label === 'Next' && target === 2) {
      // The old page-start-only lookup would jump to Chapter 2 again.
      expect(findAdjacentTocItem(book.toc!, view!.lastLocation!.cfi!, 1)?.label).toBe('Chapter 2');
    }
  }
  expect(onPage).not.toHaveBeenCalled();
}, 30_000);
