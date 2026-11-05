import { expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import type { Book } from '@/types/book';
import type { AppService } from '@/types/system';
import type { EnvConfigType } from '@/services/environment';
import { fingerprintFile } from '@/services/bookIdentity';
import { DocumentLoader } from '@/libs/document';
import { recognizeBookMetadata } from '@/glossa/metadata/recognize';
import { loadMetadataRecognition } from '@/glossa/metadata/storage';
import { extractFileMetadata } from '@/glossa/metadata/extract';

async function localEnvironment(file: File, format: Book['format']) {
  const book: Book = {
    hash: `metadata-browser-${format.toLowerCase()}`,
    format,
    title: 'Personal display name',
    author: 'Personal author',
    sourceTitle: 'fixture',
    originalFilename: `My original file.${format.toLowerCase()}`,
    contentFingerprint: await fingerprintFile(file),
    createdAt: 1,
    updatedAt: 2,
  };
  const sidecars = new Map<string, string>();
  const localPath = `${book.hash}/fixture.${format.toLowerCase()}`;
  const app = {
    resolveFilePath: async (path: string) => path,
    exists: async (path: string) => path === localPath || sidecars.has(path),
    openFile: async (path: string) => {
      if (path !== localPath) throw new Error('Missing original fixture');
      return file;
    },
    readDirectory: async () => [],
    readFile: async (path: string) => {
      const value = sidecars.get(path);
      if (value === undefined) throw new Error('Missing fixture sidecar');
      return value;
    },
    writeFile: async (path: string, _base: string, text: string) => {
      sidecars.set(path, text);
    },
    createDir: async () => {},
  } as unknown as AppService;
  const env: EnvConfigType = { getAppService: async () => app };
  return { book, env, sidecars };
}

function originalEPUB(options: { modificationOnly?: boolean; sharedContributor?: boolean } = {}) {
  const files: Record<string, string> = {
    mimetype: 'application/epub+zip',
    'META-INF/container.xml':
      '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    'OPS/book.opf': `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
      <dc:identifier id="id">urn:isbn:9780306406157</dc:identifier><dc:title>原始书名</dc:title><dc:language>zh</dc:language>
      <dc:creator id="writer">原始作者</dc:creator><meta refines="#writer" property="role" scheme="marc:relators">aut</meta>
      <dc:contributor id="translator">${options.sharedContributor ? '原始作者' : '原始译者'}</dc:contributor><meta refines="#translator" property="role" scheme="marc:relators">trl</meta>
      <dc:publisher>元数据出版社</dc:publisher>${options.modificationOnly ? '<dc:date xmlns:opf="http://www.idpf.org/2007/opf" opf:event="modification">2025-10-10</dc:date>' : '<dc:date>2019</dc:date>'}<meta property="dcterms:modified">2025-10-10T00:00:00Z</meta></metadata>
      <manifest><item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/>${Array.from({ length: 60 }, (_, index) => `<item id="s${index}" href="s${index}.xhtml" media-type="application/xhtml+xml"/>`).join('')}</manifest>
      <spine>${Array.from({ length: 60 }, (_, index) => `<itemref idref="s${index}"/>`).join('')}</spine></package>`,
    'OPS/nav.xhtml':
      '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>目录</title></head><body><nav epub:type="toc"><ol><li><a href="s0.xhtml">第一章</a></li></ol></nav><nav epub:type="landmarks"><ol><li><a epub:type="copyright-page" href="s30.xhtml#copyright">版权</a></li></ol></nav></body></html>',
  };
  for (let index = 0; index < 60; index++) {
    files[`OPS/s${index}.xhtml`] =
      `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>章节 ${index}</title></head><body>${
        index === 30
          ? '<section epub:type="copyright-page" id="copyright"><p>图书在版编目（CIP）数据</p><p>书名：原始书名</p><p>作者：原始作者</p><p>译者：原始译者</p><p>出版社：版权页出版社</p><p>2020年5月第1版</p><p>2023年8月第3次印刷</p><p>ISBN 978-0-306-40615-7</p><script>throw new Error("Book scripts must not execute")</script></section>'
          : `<p>原创正文第 ${index} 节。这里描述观察与证据的关系，不包含书目字段。</p>`
      }</body></html>`;
  }
  const bytes = zipSync(
    Object.fromEntries(Object.entries(files).map(([path, text]) => [path, strToU8(text)])),
  );
  return new File([new Uint8Array(bytes).buffer], 'fixture.epub', { type: 'application/epub+zip' });
}

function originalPDF(copyrightLines?: string[]) {
  const literal = (value: string) => value.replace(/([\\()])/g, '\\$1');
  const page = (lines: string[]) =>
    `BT /F1 12 Tf 50 740 Td 18 TL ${lines.map((line, index) => `${index ? 'T* ' : ''}(${literal(line)}) Tj`).join('\n')} ET`;
  const cover = page([
    'Original research fixture',
    'These paragraphs are written for the local metadata test.',
  ]);
  const copyright = page(
    copyrightLines ?? [
      'Copyright 1998 Original Writer',
      'Originally published in 1998',
      'First published in this translation in 2016',
      'Publisher: Research House',
      'Translated by B. Reader',
      'ISBN 978-0-306-40615-7 (hardback)',
      'ISBN 0-8044-2957-X (paperback)',
      'Reprinted 2023',
    ],
  );
  const xmp =
    '<?xpacket begin=""?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:publisher><rdf:Seq><rdf:li>Metadata Publisher</rdf:li></rdf:Seq></dc:publisher></rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R /Metadata 9 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${cover.length} >>\nstream\n${cover}\nendstream`,
    `<< /Length ${copyright.length} >>\nstream\n${copyright}\nendstream`,
    '<< /Title (Embedded PDF title) /Author (Adobe Acrobat) /CreationDate (D:20251010000000Z) >>',
    `<< /Type /Metadata /Subtype /XML /Length ${xmp.length} >>\nstream\n${xmp}\nendstream`,
  ];
  let text = '%PDF-1.7\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(text.length);
    text += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = text.length;
  text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join(
      '',
    )}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 8 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new File([text], 'fixture.pdf', { type: 'application/pdf' });
}

it('parses an original EPUB and discovers a middle copyright landmark with verified section evidence', async () => {
  const file = originalEPUB();
  const { book, env } = await localEnvironment(file, 'EPUB');
  const before = structuredClone(book);
  const result = await recognizeBookMetadata(book, env, new AbortController().signal);
  expect(result.complete).toBe(true);
  expect(result.candidates).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ field: 'translator', value: '原始译者' }),
      expect.objectContaining({
        field: 'publisher',
        value: '版权页出版社',
        confidence: 'review',
        source: expect.objectContaining({ href: 'OPS/s30.xhtml', excerpt: '出版社：版权页出版社' }),
      }),
      expect.objectContaining({
        field: 'published',
        value: '2020-05',
        source: expect.objectContaining({ href: 'OPS/s30.xhtml' }),
      }),
    ]),
  );
  expect(
    result.candidates.some(
      (candidate) => candidate.value === '2023-08' || candidate.value === '2025-10-10',
    ),
  ).toBe(false);
  const reopened = await new DocumentLoader(file, { loadPDFCache: false }).open();
  try {
    const evidence = result.candidates.find((candidate) => candidate.value === '版权页出版社')!;
    const section = reopened.book.sections.find(
      (item) => (item.href ?? item.id) === evidence.source.href,
    )!;
    expect((await section.createDocument()).documentElement.textContent).toContain(
      evidence.source.excerpt,
    );
  } finally {
    await reopened.book.destroy?.();
  }
  expect(await loadMetadataRecognition(book, env)).toEqual(result);
  expect(book).toEqual(before);
}, 30000);

it('keeps real EPUB contributor roles separate and its modification-only dc:date under review', async () => {
  const file = originalEPUB({ modificationOnly: true, sharedContributor: true });
  const opened = await new DocumentLoader(file).open();
  try {
    const result = extractFileMetadata(opened.book.metadata);
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'author', value: '原始作者' }),
        expect.objectContaining({ field: 'translator', value: '原始作者' }),
        expect.objectContaining({
          field: 'published',
          value: '2025-10-10',
          confidence: 'review',
          reason: 'Uncertain publication date',
        }),
      ]),
    );
  } finally {
    await opened.book.destroy?.();
  }
});

it('does not treat an ISBN in a PDF bibliography as copyright-page metadata', async () => {
  const file = originalPDF([
    'Recommended books',
    'ISBN 978-0-306-40615-7',
    'This list records a book cited in the preceding original prose.',
  ]);
  const { book, env } = await localEnvironment(file, 'PDF');
  const result = await recognizeBookMetadata(book, env, new AbortController().signal);
  expect(result.candidates.some((item) => item.field === 'isbn')).toBe(false);
  expect(result.candidates.every((item) => item.source.kind === 'file')).toBe(true);
}, 30000);

it('parses an original PDF text layer and XMP while separating print years and ISBN editions', async () => {
  const file = originalPDF();
  const { book, env } = await localEnvironment(file, 'PDF');
  const before = structuredClone(book);
  const result = await recognizeBookMetadata(book, env, new AbortController().signal);
  expect(result.candidates).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ field: 'title', value: 'Embedded PDF title' }),
      expect.objectContaining({
        field: 'publisher',
        value: 'Metadata Publisher',
        confidence: 'review',
      }),
      expect.objectContaining({
        field: 'publisher',
        value: 'Research House',
        confidence: 'review',
        source: expect.objectContaining({ pageIndex: 1 }),
      }),
      expect.objectContaining({ field: 'published', value: '2016' }),
      expect.objectContaining({ field: 'isbn', value: '9780306406157', confidence: 'review' }),
      expect.objectContaining({ field: 'isbn', value: '080442957X', confidence: 'review' }),
    ]),
  );
  expect(
    result.candidates.some((candidate) =>
      ['2023', '2025', 'Adobe Acrobat'].includes(candidate.value),
    ),
  ).toBe(false);
  const reopened = await new DocumentLoader(file, { loadPDFCache: false }).open();
  try {
    for (const evidence of result.candidates.filter(
      (candidate) => candidate.source.kind === 'text',
    )) {
      const text = await reopened.book.getPDFText!(evidence.source.pageIndex!);
      expect(text).toContain(evidence.source.excerpt);
    }
  } finally {
    await reopened.book.destroy?.();
  }
  expect(await loadMetadataRecognition(book, env)).toEqual(result);
  expect(book).toEqual(before);
}, 30000);
