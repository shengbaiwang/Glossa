import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { BookDoc } from '@/libs/document';
import type { PDFCache, OCRPage } from '@/services/pdfEnhancement';
import { preparePDFContents } from '@/services/pdfAutoContents';

const native = vi.hoisted(() => ({
  cache: { id: 'a'.repeat(32), pages: [], outline: null, revision: 0 } as PDFCache,
  open: vi.fn(),
  read: vi.fn(),
  start: vi.fn(),
  wait: vi.fn(),
  save: vi.fn(),
  cancel: vi.fn(),
  checkpoints: new Map<string, unknown>(),
  checkpointSave: vi.fn(),
}));
vi.mock('@/glossa/harness/derivedStore', async () => {
  const { createHash } = await import('node:crypto');
  return {
    hashData: async (value: unknown) =>
      createHash('sha256').update(JSON.stringify(value)).digest('hex'),
    createDerivedStore: (_database: string, schema: import('zod').ZodType) => ({
      load: async (key: string) => {
        const parsed = schema.safeParse(native.checkpoints.get(key));
        return parsed.success ? structuredClone(parsed.data) : null;
      },
      save: async (key: string, value: unknown) => {
        await native.checkpointSave(key, value);
        native.checkpoints.set(key, structuredClone(schema.parse(value)));
      },
    }),
  };
});
vi.mock('@/services/pdfEnhancement', async (original) => ({
  ...(await original<typeof import('@/services/pdfEnhancement')>()),
  openPDFCache: native.open,
  readOCRPage: native.read,
  startPDFOCR: native.start,
  waitForPDFOCR: native.wait,
  savePDFOutline: native.save,
  cancelPDFOCR: native.cancel,
}));

const contents =
  'Contents\nChapter 1 Copper .... 1\nChapter 2 Amber .... 5\nChapter 3 Silver .... 9';

beforeAll(async () => {
  const { readFile } = await import('node:fs/promises');
  const { default: init } = await import('@simplecc/simplecc_wasm');
  await init({ module_or_path: await readFile('public/vendor/simplecc/simplecc_wasm_bg.wasm') });
});

it('matches equivalent traditional and simplified headings without treating other OCR substitutions as spelling', async () => {
  expect(
    await preparePDFContents(
      '/original.pdf',
      document({ 1: 'Contents\n致謝 .... 5\n第二章 測試 .... 9', 4: '致谢', 8: '第二章 测试' }),
    ),
  ).toBe('generated');
  expect(native.save.mock.calls.at(-1)![2]).toHaveLength(2);
});

it.each([
  false,
  true,
])('excludes only marginal running headers (interior title present: %s)', async (interior) => {
  const scan = (index: number, rows: [string, number][]): OCRPage => ({
    index,
    native: false,
    lines: rows.map(([text, y]) => ({
      text,
      x: 0.2,
      y,
      width: 0.6,
      height: 0.02,
      endLine: true,
    })),
  });
  const scans = new Map([
    [
      1,
      scan(1, [
        ['A history of reading', 0.035],
        ['Contents', 0.15],
        ['Chapter 1 Copper .... 1', 0.25],
        ['Chapter 2 Amber .... 5', 0.35],
      ]),
    ],
    [
      2,
      scan(2, [
        ['A history of readinq', 0.036],
        ['Chapter 3 Silver .... 9', 0.25],
        ...(interior ? [['A history of reading', 0.45] as [string, number]] : []),
      ]),
    ],
  ]);
  native.cache.pages = [1, 2];
  native.read.mockImplementation(async (_id, index) => scans.get(index) ?? null);
  const result = await preparePDFContents(
    '/original.pdf',
    document({
      4: 'Chapter 1 Copper',
      8: 'Chapter 2 Amber',
      12: 'Chapter 3 Silver',
    }),
  );
  if (interior) {
    expect(result).toBe('unavailable');
    expect(native.save).not.toHaveBeenCalled();
    return;
  }
  expect(result).toBe('generated');
  expect(native.save.mock.calls[0]![2]).toEqual([
    { title: 'Chapter 1 Copper', pageIndex: 4, level: 0 },
    { title: 'Chapter 2 Amber', pageIndex: 8, level: 0 },
    { title: 'Chapter 3 Silver', pageIndex: 12, level: 0 },
  ]);
});
function document(texts: Record<number, string>, count = 16): BookDoc {
  return {
    sections: Array.from({ length: count }, () => ({})),
    getPDFText: vi.fn(
      async (index: number) => texts[index] ?? 'Ordinary paragraph without a heading.',
    ),
  } as unknown as BookDoc;
}
beforeEach(() => {
  vi.clearAllMocks();
  native.checkpoints.clear();
  native.cache = { id: 'a'.repeat(32), pages: [], outline: null, revision: 0 };
  native.open.mockImplementation(async () => ({ ...native.cache }));
  native.read.mockResolvedValue(null);
  native.cancel.mockResolvedValue(undefined);
  native.start.mockResolvedValue({ cacheId: native.cache.id, state: 'running' });
  native.wait.mockResolvedValue({ state: 'completed' });
  native.save.mockImplementation(async (_source, _cache, outline) => ({
    ...native.cache,
    outline,
    revision: 1,
  }));
});

it.each([
  '辑一',
  '第一辑',
  '第一部',
  '第一篇',
])('keeps %s as a parent across contents pages, with independent front and back matter', async (part) => {
  const second = part.replace('一', '二');
  const doc = document({
    0: `目录\n序·观察 .... 4\n${part} 山乡系列 .... 5\n铜与琥珀 .... 6`,
    1: `白银的来历 .... 8\n${second} 古装系列 .... 10\n新的开始 .... 11\n后记 .... 14`,
    3: '序·观察',
    4: `${part} 山乡系列`,
    5: '铜与琥珀',
    7: '白银的来历',
    9: `${second} 古装系列`,
    10: '新的开始',
    13: '后记',
  });
  expect(await preparePDFContents('/original.pdf', doc)).toBe('generated');
  expect(native.save.mock.calls.at(-1)![2]).toEqual([
    { title: '序·观察', pageIndex: 3, level: 0 },
    { title: `${part} 山乡系列`, pageIndex: 4, level: 0 },
    { title: '铜与琥珀', pageIndex: 5, level: 1 },
    { title: '白银的来历', pageIndex: 7, level: 1 },
    { title: `${second} 古装系列`, pageIndex: 9, level: 0 },
    { title: '新的开始', pageIndex: 10, level: 1 },
    { title: '后记', pageIndex: 13, level: 0 },
  ]);
});

it('independently locates an unnumbered full part title instead of merging it into the next article', async () => {
  const doc = document({
    0: '目录\n第一部 山乡系列\n铜与琥珀 .... 6\n第二部 古装系列\n白银的来历 .... 11',
    4: '第一部\n山乡系列',
    5: '铜与琥珀',
    9: '第二部\n古装系列',
    10: '白银的来历',
  });
  expect(await preparePDFContents('/original.pdf', doc)).toBe('generated');
  expect(native.save.mock.calls.at(-1)![2]).toEqual([
    { title: '第一部 山乡系列', pageIndex: 4, level: 0 },
    { title: '铜与琥珀', pageIndex: 5, level: 1 },
    { title: '第二部 古装系列', pageIndex: 9, level: 0 },
    { title: '白银的来历', pageIndex: 10, level: 1 },
  ]);
});

it.each([
  '第一部',
  'Part I',
])('keeps an ordinal-only %s without guessing that the next article completes its title', async (part) => {
  const doc = document({
    0: `目录\n${part}\nCopper .... 6\nAmber .... 11`,
    4: part,
    5: 'Copper',
    10: 'Amber',
  });
  expect(await preparePDFContents('/original.pdf', doc)).toBe('generated');
  expect(native.save.mock.calls.at(-1)![2]).toEqual([
    { title: part, pageIndex: 4, level: 0 },
    { title: 'Copper', pageIndex: 5, level: 1 },
    { title: 'Amber', pageIndex: 10, level: 1 },
  ]);
});

it('retains small, numbered OCR articles when larger sibling rows set the median type size', async () => {
  const rows = [
    ['目录', 0.04, 0.04],
    ['辑一 山乡', 0.18, 0.035],
    ['铜与琥珀 .... 6', 0.3, 0.02],
    ['后记 .... 12', 0.6, 0.04],
    ['附录1:材料 .... 14', 0.75, 0.04],
  ] as const;
  const page: OCRPage = {
    index: 0,
    native: false,
    lines: rows.map(([text, y, height]) => ({
      text,
      y,
      height,
      x: 0.1,
      width: 0.7,
      endLine: true,
    })),
  };
  native.cache.pages = [0];
  native.read.mockImplementation(async (_id, index) => (index === 0 ? page : null));
  expect(
    await preparePDFContents(
      '/original.pdf',
      document({ 4: '辑一 山乡', 5: '铜与琥珀', 11: '后记', 13: '附录1:材料' }),
    ),
  ).toBe('generated');
  expect(native.save.mock.calls.at(-1)![2].map((row: { title: string }) => row.title)).toEqual([
    '辑一 山乡',
    '铜与琥珀',
    '后记',
    '附录1:材料',
  ]);
});

it.each([
  0.012, 0.020000000000000018,
])('retains a no-folio parent at height %s despite larger article text', async (height) => {
  const page: OCRPage = {
    index: 0,
    native: false,
    lines: [
      ['目录', 0.04, 0.04],
      ['辑一 山乡', 0.18, height],
      ['铜与琥珀 .... 6', 0.3, 0.025000000000000022],
      ['白银的来历 .... 11', 0.6, 0.025000000000000022],
      ['This original fixture contains no private book content.', 0.9, 0.006],
    ].map(([text, y, size]) => ({
      text: String(text),
      y: Number(y),
      height: Number(size),
      x: 0.1,
      width: 0.7,
      endLine: true,
    })),
  };
  native.cache.pages = [0];
  native.read.mockImplementation(async (_id, index) => (index === 0 ? page : null));
  expect(
    await preparePDFContents(
      '/original.pdf',
      document({ 4: '辑一 山乡', 5: '铜与琥珀', 10: '白银的来历' }),
    ),
  ).toBe('generated');
  expect(native.save.mock.calls.at(-1)![2]).toEqual([
    { title: '辑一 山乡', pageIndex: 4, level: 0 },
    { title: '铜与琥珀', pageIndex: 5, level: 1 },
    { title: '白银的来历', pageIndex: 10, level: 1 },
  ]);
});

it.each([
  '辑一 山乡\n铜与琥珀 .... 6\n辑三 古装\n白银的来历 .... 11',
  '辑二 山乡\n铜与琥珀 .... 6\n辑三 古装\n白银的来历 .... 11',
  '辑一 山乡\n铜与琥珀 .... 6\n辑一 古装\n白银的来历 .... 11',
  'Part I Hills\nCopper .... 6\nPart III Cities\nSilver .... 11',
])('rejects a gap in sibling part numbers and preserves the previous outline: %s', async (table) => {
  const old = [{ title: 'Previous contents', pageIndex: 3, level: 0 }];
  native.cache.outline = old;
  native.cache.generator = 'glossa-contents-3';
  const titles = table.split('\n').map((line) => line.replace(/ \.\.\.\. \d+$/, ''));
  const reports: import('@/services/pdfAutoContents').PDFContentsReport[] = [];
  expect(
    await preparePDFContents(
      '/original.pdf',
      document({
        0: `目录\n${table}`,
        4: titles[0]!,
        5: titles[1]!,
        9: titles[2]!,
        10: titles[3]!,
      }),
      undefined,
      (r) => reports.push(r),
      { regenerate: true },
    ),
  ).toBe('unavailable');
  expect(native.save).not.toHaveBeenCalled();
  expect(native.cache.outline).toEqual(old);
  expect(reports.at(-1)).toMatchObject({
    state: 'unavailable',
    code: 'pdf_contents_structure_incomplete',
  });
});

it.each([
  'missing',
  'ownership',
])('checks the source inventory again before publishing a resumed plan (%s)', async (fault) => {
  const texts = {
    0: '目录\n辑一 山乡 .... 5\n铜与琥珀 .... 6\n辑二 古装 .... 10\n白银的来历 .... 11',
    4: '辑一 山乡',
    5: '铜与琥珀',
    9: '辑二 古装',
    10: '白银的来历',
  };
  const controller = new AbortController();
  native.checkpointSave.mockImplementation(async (_key, value) => {
    if (value.plan?.completed?.length === 1) controller.abort();
  });
  await expect(
    preparePDFContents('/original.pdf', document(texts), controller.signal),
  ).rejects.toMatchObject({ name: 'AbortError' });
  native.checkpointSave.mockReset();
  for (const value of native.checkpoints.values()) {
    const record = value as { plan: { rows: { level: number }[]; completed: unknown[] } };
    if (fault === 'missing') record.plan.rows.splice(2, 1);
    else record.plan.rows[3]!.level = 0;
    record.plan.completed = [];
  }
  expect(await preparePDFContents('/original.pdf', document(texts))).toBe('unavailable');
  expect(native.save).not.toHaveBeenCalled();
});

it('recovers a small geometric parent missing from native filtered lines and verifies every raw title', async () => {
  const doc = document({
    0: '目录\n铜与琥珀 .... 6\n白银的来历 .... 11',
    4: '山乡系列',
    5: '铜与琥珀',
    10: '白银的来历',
  });
  doc.getPDFContentsLayout = async (index) =>
    index === 0
      ? [
          { text: '目录', x: 0.1, y: 0.04, width: 0.7, height: 0.04 },
          { text: '山乡系列', x: 0.1, y: 0.18, width: 0.7, height: 0.012 },
          { text: '铜与琥珀 .... 6', x: 0.1198, y: 0.3, width: 0.7, height: 0.025 },
          { text: '白银的来历 .... 11', x: 0.1198, y: 0.6, width: 0.7, height: 0.025 },
        ]
      : [];
  expect(await preparePDFContents('/original.pdf', doc)).toBe('generated');
  expect(native.save.mock.calls.at(-1)![2]).toEqual([
    { title: '山乡系列', pageIndex: 4, level: 0 },
    { title: '铜与琥珀', pageIndex: 5, level: 1 },
    { title: '白银的来历', pageIndex: 10, level: 1 },
  ]);
});

it('allows part numbering to restart inside a different parent volume', async () => {
  const doc = document({
    0: '目录\n第一部 山乡 .... 4\n第一篇 铜 .... 5\n第二篇 琥珀 .... 6\n第二部 城市 .... 9\n第一篇 白银 .... 10',
    3: '第一部 山乡',
    4: '第一篇 铜',
    5: '第二篇 琥珀',
    8: '第二部 城市',
    9: '第一篇 白银',
  });
  expect(await preparePDFContents('/original.pdf', doc)).toBe('generated');
  expect(native.save.mock.calls.at(-1)![2].map((entry: { level: number }) => entry.level)).toEqual([
    0, 1, 1, 0, 1,
  ]);
});

it('retains a dated part heading and rejects publication when its own destination is missing', async () => {
  const doc = document({
    0: '目录\n第一部分 1889—1919\n铜与琥珀 .... 6\n白银的来历 .... 11',
    5: '铜与琥珀',
    10: '白银的来历',
  });
  expect(await preparePDFContents('/original.pdf', doc)).toBe('unavailable');
  expect(native.save).not.toHaveBeenCalled();
});

it('ends a part at numbered appendices without confusing a chapter title beginning with 序', async () => {
  const doc = document({
    0: '目录\n辑一 山乡 .... 4\n序言的故事 .... 6\n附录1:材料 .... 9\n附录2:地图 .... 12',
    3: '辑一 山乡',
    5: '序言的故事',
    8: '附录1:材料',
    11: '附录2:地图',
  });
  expect(await preparePDFContents('/original.pdf', doc)).toBe('generated');
  expect(native.save.mock.calls.at(-1)![2].map((entry: { level: number }) => entry.level)).toEqual([
    0, 1, 0, 0,
  ]);
});

it('keeps nested parts and numbered sections while leaving numbered articles without children as siblings', async () => {
  const doc = document({
    0: '目录\n第一部 观察 .... 4\n第一篇 山乡 .... 5\n第一章 铜与琥珀 .... 6\n第一节 铜 .... 7\n第二篇 城市 .... 9\n第二章 白银 .... 10\n后记 .... 13',
    3: '第一部 观察',
    4: '第一篇 山乡',
    5: '第一章 铜与琥珀',
    6: '第一节 铜',
    8: '第二篇 城市',
    9: '第二章 白银',
    12: '后记',
  });
  expect(await preparePDFContents('/original.pdf', doc)).toBe('generated');
  expect(native.save.mock.calls.at(-1)![2].map((entry: { level: number }) => entry.level)).toEqual([
    0, 1, 2, 3, 1, 2, 0,
  ]);
  native.checkpoints.clear();
  native.save.mockClear();
  const articles = document({
    0: '目录\n第一篇 铜与琥珀 .... 5\n第二篇 白银 .... 9',
    4: '第一篇 铜与琥珀',
    8: '第二篇 白银',
  });
  expect(await preparePDFContents('/original.pdf', articles)).toBe('generated');
  expect(native.save.mock.calls.at(-1)![2].map((entry: { level: number }) => entry.level)).toEqual([
    0, 0,
  ]);
});

it.each([
  false,
  true,
])('uses type size, indentation and whitespace for unnumbered group titles (ordinal only: %s)', async (ordinal) => {
  const first = ordinal ? '第一辑' : '山乡系列';
  const second = ordinal ? '第二辑' : '古装系列';
  const line = (text: string, y: number, height: number, x = 0.15) => ({
    text,
    x,
    y,
    height,
    width: 0.65,
    endLine: true,
  });
  const page: OCRPage = {
    index: 0,
    native: false,
    lines: [
      line('目录', 0.04, 0.04),
      line(first, 0.18, 0.035),
      line('铜与琥珀 .... 6', 0.3, 0.025, 0.2),
      line('后记 .... 8', 0.37, 0.025, 0.2),
      line(second, 0.53, 0.035),
      line('白银的来历 .... 11', 0.65, 0.025, 0.2),
      line('后记 .... 14', 0.84, 0.035),
    ],
  };
  native.cache.pages = [0];
  native.read.mockImplementation(async (_id, index) => (index === 0 ? page : null));
  const doc = document({
    4: first,
    5: '铜与琥珀',
    7: '后记',
    9: second,
    10: '白银的来历',
    13: '后记',
  });
  expect(await preparePDFContents('/original.pdf', doc)).toBe('generated');
  expect(native.save.mock.calls.at(-1)![2]).toEqual([
    { title: first, pageIndex: 4, level: 0 },
    { title: '铜与琥珀', pageIndex: 5, level: 1 },
    { title: '后记', pageIndex: 7, level: 1 },
    { title: second, pageIndex: 9, level: 0 },
    { title: '白银的来历', pageIndex: 10, level: 1 },
    { title: '后记', pageIndex: 13, level: 0 },
  ]);
});

it('automatically calibrates a printed TOC and saves only after every destination is checked', async () => {
  const doc = document({
    1: contents,
    4: 'Chapter 1 Copper',
    8: 'Chapter 2 Amber',
    12: 'Chapter 3 Silver',
  });
  expect(await preparePDFContents('/original.pdf', doc)).toBe('generated');
  expect(native.save.mock.calls[0]![2]).toEqual([
    { title: 'Chapter 1 Copper', pageIndex: 4, level: 0 },
    { title: 'Chapter 2 Amber', pageIndex: 8, level: 0 },
    { title: 'Chapter 3 Silver', pageIndex: 12, level: 0 },
  ]);
  expect(native.start).not.toHaveBeenCalled();
});

it.each([
  [false, false],
  [true, false],
  [false, true],
])('uses a local heading plus two independent marginal folios before scanning the whole book (conflict: %s, blurred preview: %s)', async (conflict, blurred) => {
  const { doc } = scan(
    {
      1: 'Contents\nCopper .... 1\nAmber .... 5',
      4: 'Copper',
      5: '002 Body',
      6: `Body\n${conflict ? '099' : '003'}`,
      8: 'Amber',
    },
    100,
  );
  const read = native.read.getMockImplementation()!;
  native.read.mockImplementation(async (...args) => {
    const page = (await read(...args)) as OCRPage | null;
    return page && [5, 6].includes(args[1])
      ? {
          ...page,
          lines: page.lines.map((line) =>
            /^\d/.test(line.text)
              ? {
                  ...line,
                  y: 0.95,
                  text: args[2] && blurred ? line.text.replace(/\d/g, 'O') : line.text,
                }
              : line,
          ),
        }
      : page;
  });
  const text = doc.getPDFText as ReturnType<typeof vi.fn>;
  text.mockResolvedValue('');
  expect(await preparePDFContents('/original.pdf', doc)).toBe('generated');
  expect(
    native.start.mock.calls.some((args) => args[3] && args[2].some((index: number) => index >= 40)),
  ).toBe(conflict);
  expect(native.save.mock.calls.at(-1)![2]).toEqual([
    { title: 'Copper', pageIndex: 4, level: 0 },
    { title: 'Amber', pageIndex: 8, level: 0 },
  ]);
});

it.each([
  false,
  true,
])('calibrates an unnumbered part using a following precise heading despite a coarse typo (%s)', async (blurred) => {
  const texts = {
    1: 'Contents\nCopper\nAmber observations .... 3\nSilver .... 7',
    4: 'Copper',
    6: 'Amber observations',
    7: '004 Body',
    8: 'Body\n005',
    10: 'Silver',
  };
  const { doc } = scan(texts, 100, { ...texts, 6: blurred ? 'Amber 0bservations' : texts[6] });
  const read = native.read.getMockImplementation()!;
  native.read.mockImplementation(async (...args) => {
    const page = (await read(...args)) as OCRPage | null;
    return page && [7, 8].includes(args[1])
      ? {
          ...page,
          lines: page.lines.map((line) => (/\d/.test(line.text) ? { ...line, y: 0.95 } : line)),
        }
      : page;
  });
  expect(await preparePDFContents('/original.pdf', doc)).toBe('generated');
  expect(
    native.start.mock.calls.some((args) => args[3] && args[2].some((index: number) => index >= 40)),
  ).toBe(false);
  expect(
    native.save.mock.calls.at(-1)![2].map((entry: { pageIndex: number }) => entry.pageIndex),
  ).toEqual([4, 6, 10]);
});

it.each([
  false,
  true,
])('uses every native index link and never treats the table as its own destination (links: %s)', async (links) => {
  const doc = document({
    1: 'Chapter 1 Copper\nChapter 2 Amber\nChapter 3 Silver',
    4: 'Chapter 1 Copper',
    8: 'Chapter 2 Amber',
    12: 'Chapter 3 Silver',
  });
  if (links)
    doc.getPDFContentsLinks = vi.fn(async (index) =>
      index === 1
        ? [
            { title: 'Chapter 1 Copper', pageIndex: 4, level: 0 },
            { title: 'Chapter 2 Amber', pageIndex: 8, level: 0 },
            { title: 'Chapter 3 Silver', pageIndex: 12, level: 0 },
          ]
        : null,
    );
  expect(await preparePDFContents('/original.pdf', doc)).toBe(links ? 'generated' : 'unavailable');
  if (links)
    expect(
      native.save.mock.calls.at(-1)![2].map((entry: { pageIndex: number }) => entry.pageIndex),
    ).toEqual([4, 8, 12]);
  else expect(native.save).not.toHaveBeenCalled();
});

it('recalibrates an unnumbered part after front matter with a different physical offset', async () => {
  const { doc } = scan(
    {
      11: 'Contents\nPreface .... 1\nCopper\nAmber .... 3\nSilver .... 7',
      4: 'Preface',
      5: '002 Body',
      6: '003 Body',
      15: 'Copper',
      17: 'Amber',
      18: '004 Body',
      19: '005 Body',
      21: 'Silver',
    },
    100,
  );
  const read = native.read.getMockImplementation()!;
  native.read.mockImplementation(async (...args) => {
    const page = (await read(...args)) as OCRPage | null;
    return page && [5, 6, 18, 19].includes(args[1])
      ? { ...page, lines: page.lines.map((line) => ({ ...line, y: 0.95 })) }
      : page;
  });
  expect(await preparePDFContents('/original.pdf', doc)).toBe('generated');
  expect(
    native.start.mock.calls.some((args) => args[3] && args[2].some((index: number) => index >= 60)),
  ).toBe(false);
  expect(
    native.save.mock.calls.at(-1)![2].map((entry: { pageIndex: number }) => entry.pageIndex),
  ).toEqual([4, 15, 17, 21]);
});

it.each([
  false,
  true,
])('ends a linked TOC before prose while retaining a short linked continuation (%s)', async (continuation) => {
  const doc = document({
    1: 'Chapter 1 Copper\nChapter 2 Amber\nChapter 3 Silver',
    2: continuation ? 'Appendix Tin\nAppendix Gold' : 'Printed reference 3\nOther prose 7',
    4: 'Chapter 1 Copper',
    8: 'Chapter 2 Amber',
    12: 'Chapter 3 Silver',
    13: 'Appendix Tin',
    15: 'Appendix Gold',
  });
  const first = [
    { title: 'Chapter 1 Copper', pageIndex: 4, level: 0 },
    { title: 'Chapter 2 Amber', pageIndex: 8, level: 0 },
    { title: 'Chapter 3 Silver', pageIndex: 12, level: 0 },
  ];
  const last = [
    { title: 'Appendix Tin', pageIndex: 13, level: 0 },
    { title: 'Appendix Gold', pageIndex: 15, level: 0 },
  ];
  doc.getPDFContentsLinks = vi.fn(async (index) =>
    index === 1 ? first : continuation && index === 2 ? last : null,
  );
  expect(await preparePDFContents('/original.pdf', doc)).toBe('generated');
  expect(native.save.mock.calls.at(-1)![2]).toEqual([...first, ...(continuation ? last : [])]);
});

it('persists a verified prefix and resumes without rereading unrelated pages', async () => {
  const controller = new AbortController();
  native.checkpointSave.mockImplementation(async (_key, value) => {
    if (value.plan?.completed?.length === 2) controller.abort();
  });
  const texts = {
    1: contents,
    4: 'Chapter 1 Copper',
    8: 'Chapter 2 Amber',
    12: 'Chapter 3 Silver',
  };
  await expect(
    preparePDFContents('/original.pdf', document(texts), controller.signal),
  ).rejects.toMatchObject({ name: 'AbortError' });
  const saved = [...native.checkpoints.values()].at(-1) as {
    plan?: { completed: unknown[]; rows: unknown[] };
  };
  expect(saved.plan?.completed).toHaveLength(2);
  expect(saved.plan?.rows).toHaveLength(3);
  expect(native.save).not.toHaveBeenCalled();
  native.checkpointSave.mockReset();
  const retry = document(texts);
  const originalRead = retry.getPDFText!;
  retry.getPDFText = vi.fn(async (index) => {
    if (index === 0) throw new Error('Unrelated pages must not be rediscovered');
    return originalRead(index);
  });
  const reports: import('@/services/pdfAutoContents').PDFContentsReport[] = [];
  expect(await preparePDFContents('/original.pdf', retry, undefined, (r) => reports.push(r))).toBe(
    'generated',
  );
  expect(reports.some((r) => r.resumed && r.totalCount === 3)).toBe(true);
  expect(native.save.mock.calls[0]![2].map((e: { pageIndex: number }) => e.pageIndex)).toEqual([
    4, 8, 12,
  ]);
});

it('invalidates a resumed plan when its source table or saved revision changes', async () => {
  const texts = {
    1: contents,
    4: 'Chapter 1 Copper',
    8: 'Chapter 2 Amber',
    12: 'Chapter 3 Silver',
  };
  const controller = new AbortController();
  native.checkpointSave.mockImplementation(async (_key, value) => {
    if (value.plan?.completed?.length === 1) controller.abort();
  });
  await expect(
    preparePDFContents('/original.pdf', document(texts), controller.signal),
  ).rejects.toMatchObject({ name: 'AbortError' });
  native.checkpointSave.mockReset();
  native.cache.revision = 7;
  native.cache.generator = 'glossa-pages-1';
  const changed = document({ ...texts, 1: 'Contents\nChapter 1 Copper 1\nChapter 3 Silver 9' });
  expect(await preparePDFContents('/original.pdf', changed)).toBe('generated');
  expect(native.save.mock.calls[0]![2]).toHaveLength(2);
  expect(changed.getPDFText).toHaveBeenCalledWith(0);
});

it('discards an older extraction plan while retaining compatible heading verification records', async () => {
  const texts = {
    1: contents,
    4: 'Chapter 1 Copper',
    8: 'Chapter 2 Amber',
    12: 'Chapter 3 Silver',
  };
  const controller = new AbortController();
  native.checkpointSave.mockImplementation(async (_key, value) => {
    if (value.plan?.completed?.length === 1) controller.abort();
  });
  await expect(
    preparePDFContents('/original.pdf', document(texts), controller.signal),
  ).rejects.toMatchObject({ name: 'AbortError' });
  let compatible: unknown;
  for (const saved of native.checkpoints.values()) {
    const record = saved as {
      entries: unknown[];
      plan: { extractor: string; rows: { title: string }[] };
    };
    compatible = structuredClone(record.entries);
    record.plan.extractor = 'pdf-contents-8';
    record.plan.rows[0]!.title = 'Stale extraction proposal';
  }
  native.checkpointSave.mockReset();
  const snapshots: unknown[] = [];
  native.checkpointSave.mockImplementation(async (_key, value) => {
    snapshots.push(structuredClone(value.entries));
  });
  const reports: import('@/services/pdfAutoContents').PDFContentsReport[] = [];
  const retry = document(texts);
  expect(
    await preparePDFContents('/original.pdf', retry, undefined, (value) => reports.push(value)),
  ).toBe('generated');
  expect(retry.getPDFText).toHaveBeenCalledWith(0);
  expect(reports.some((report) => report.resumed)).toBe(false);
  expect(snapshots[0]).toEqual(compatible);
  expect(native.save.mock.calls.at(-1)![2][0].title).toBe('Chapter 1 Copper');
});

it('never publishes a stale completed prefix after its destination evidence changes', async () => {
  const controller = new AbortController();
  const texts = {
    1: contents,
    4: 'Chapter 1 Copper',
    8: 'Chapter 2 Amber',
    12: 'Chapter 3 Silver',
  };
  native.checkpointSave.mockImplementation(async (_key, value) => {
    if (value.plan?.completed?.length === 2) controller.abort();
  });
  await expect(
    preparePDFContents('/original.pdf', document(texts), controller.signal),
  ).rejects.toMatchObject({ name: 'AbortError' });
  native.checkpointSave.mockReset();
  expect(
    await preparePDFContents('/original.pdf', document({ ...texts, 4: 'Unrelated title' })),
  ).toBe('unavailable');
  expect(native.save).not.toHaveBeenCalled();
});

it('re-extracts a table whose OCR or native evidence changed at the same revision', async () => {
  const controller = new AbortController();
  const texts = {
    1: contents,
    4: 'Chapter 1 Copper',
    8: 'Chapter 2 Amber',
    12: 'Chapter 3 Silver',
  };
  native.checkpointSave.mockImplementation(async (_key, value) => {
    if (value.plan?.completed?.length === 1) controller.abort();
  });
  await expect(
    preparePDFContents('/original.pdf', document(texts), controller.signal),
  ).rejects.toMatchObject({ name: 'AbortError' });
  native.checkpointSave.mockReset();
  const changed = document({ ...texts, 1: 'Contents\nChapter 1 Copper 1\nChapter 3 Silver 9' });
  expect(await preparePDFContents('/original.pdf', changed)).toBe('generated');
  expect(native.save.mock.calls[0]![2]).toHaveLength(2);
});

it('regenerates an automatic outline on explicit request, retaining it if verification fails', async () => {
  native.cache.generator = 'glossa-contents-3';
  native.cache.outline = [{ title: 'Previous chapter', pageIndex: 4, level: 0 }];
  const doc = document({
    1: contents,
    4: 'Chapter 1 Copper',
    8: 'Chapter 2 Amber',
    12: 'Chapter 3 Silver',
  });
  expect(
    await preparePDFContents('/original.pdf', doc, undefined, undefined, { regenerate: true }),
  ).toBe('generated');
  expect(native.save.mock.calls[0]![2]).toHaveLength(3);
  native.save.mockClear();
  const failed = document({ 1: contents });
  failed.toc = [{ id: 0, label: 'Previous chapter', index: 4, href: '4' }];
  expect(
    await preparePDFContents('/original.pdf', failed, undefined, undefined, { regenerate: true }),
  ).toBe('unavailable');
  expect(native.save).not.toHaveBeenCalled();
});

it('never replaces a personal outline even when regeneration is requested', async () => {
  native.cache.outline = [{ title: 'My heading', pageIndex: 3, level: 0 }];
  expect(
    await preparePDFContents('/original.pdf', document({ 1: contents }), undefined, undefined, {
      regenerate: true,
    }),
  ).toBe('preserved');
  expect(native.save).not.toHaveBeenCalled();
});

it('rejects a plausible offset if even one destination is wrong', async () => {
  expect(
    await preparePDFContents(
      '/original.pdf',
      document({ 1: contents, 4: 'Chapter 1 Copper', 8: 'Chapter 2 Amber' }),
    ),
  ).toBe('unavailable');
  expect(native.save).not.toHaveBeenCalled();
});

it('does not silently omit an out-of-range printed contents entry', async () => {
  const doc = document({
    1: `${contents}\nChapter 4 Missing .... 99`,
    4: 'Chapter 1 Copper',
    8: 'Chapter 2 Amber',
    12: 'Chapter 3 Silver',
  });
  expect(await preparePDFContents('/original.pdf', doc)).toBe('unavailable');
  expect(native.save).not.toHaveBeenCalled();
});

it('does not let a contents page verify itself or invent chapters from paragraphs', async () => {
  await preparePDFContents('/original.pdf', document({ 0: contents }));
  expect(native.save).not.toHaveBeenCalled();
});

it('does not turn unresolved contents rows into chapter headings during fallback', async () => {
  const doc = document({
    0: 'Contents\nChapter 1 Missing 9\nChapter 2 Amber 1',
    4: 'Chapter 1 Copper',
    8: 'Chapter 2 Amber',
  });
  expect(await preparePDFContents('/original.pdf', doc)).toBe('unavailable');
  expect(native.save).not.toHaveBeenCalled();
});

it('includes a final contents continuation page with only one entry', async () => {
  const doc = document({
    1: 'Contents\nChapter 1 Copper .... 1\nChapter 2 Amber .... 5',
    2: 'Chapter 3 Silver .... 9',
    4: 'Chapter 1 Copper',
    8: 'Chapter 2 Amber',
    12: 'Chapter 3 Silver',
  });
  expect(await preparePDFContents('/original.pdf', doc)).toBe('generated');
  expect(native.save.mock.calls[0]![2]).toHaveLength(3);
});

it('reads beyond the old discovery boundary before accepting the complete table', async () => {
  const doc = document(
    {
      23: contents,
      24: 'Chapter 1 Copper',
      28: 'Chapter 2 Amber',
      32: 'Chapter 3 Silver',
    },
    40,
  );
  expect(await preparePDFContents('/original.pdf', doc)).toBe('generated');
  expect(doc.getPDFText).toHaveBeenCalledWith(25);
  expect(native.save.mock.calls[0]![2]).toHaveLength(3);
});

it('preserves a personal outline, including an intentionally empty outline', async () => {
  for (const outline of [[], [{ title: 'My reading', pageIndex: 2, level: 0 }]]) {
    native.cache.outline = outline;
    const doc = document({});
    expect(await preparePDFContents('/original.pdf', doc)).toBe('preserved');
    expect(doc.getPDFText).not.toHaveBeenCalled();
  }
  expect(native.save).not.toHaveBeenCalled();
});

it('rebuilds old automatic outlines and reuses only the current verified algorithm version', async () => {
  native.cache.generator = 'glossa-contents-1';
  native.cache.outline = [{ title: 'Chapter 1 Copper', pageIndex: 4, level: 0 }];
  const doc = document({
    1: contents,
    4: 'Chapter 1 Copper',
    8: 'Chapter 2 Amber',
    12: 'Chapter 3 Silver',
  });
  expect(await preparePDFContents('/original.pdf', doc)).toBe('generated');
  expect(native.save.mock.calls[0]![2]).toHaveLength(3);
  expect(native.save.mock.calls[0]![4]).toBe('glossa-contents-3');
  native.cache.generator = 'glossa-contents-3';
  expect(await preparePDFContents('/original.pdf', doc)).toBe('preserved');
});

it('keeps a verified embedded TOC without OCR or replacing it', async () => {
  const doc = document({ 4: 'Chapter 1 Copper', 8: 'Chapter 2 Amber' });
  doc.toc = [
    { id: 0, label: 'Chapter 1 Copper', index: 4, href: '[4,{"name":"Fit"}]' },
    { id: 1, label: 'Chapter 2 Amber', index: 8, href: '[8,{"name":"Fit"}]' },
  ];
  expect(await preparePDFContents('/original.pdf', doc)).toBe('preserved');
  expect(native.start).not.toHaveBeenCalled();
  expect(native.save).not.toHaveBeenCalled();
});

it('keeps accurate embedded titles that omit the printed chapter number', async () => {
  const doc = document({ 4: 'Chapter 1 Copper experiments', 8: 'Chapter 2 Amber observations' });
  doc.toc = [
    { id: 0, label: 'Copper experiments', index: 4, href: '[4,{"name":"Fit"}]' },
    { id: 1, label: 'Amber observations', index: 8, href: '[8,{"name":"Fit"}]' },
  ];
  expect(await preparePDFContents('/original.pdf', doc)).toBe('preserved');
  expect(native.start).not.toHaveBeenCalled();
  expect(native.save).not.toHaveBeenCalled();
});

it('replaces a wrong embedded outline with locally verified contents', async () => {
  const doc = document({
    1: contents,
    4: 'Chapter 1 Copper',
    8: 'Chapter 2 Amber',
    12: 'Chapter 3 Silver',
  });
  doc.toc = [{ id: 0, label: 'Wrong chapter', index: 0, href: '[0,{"name":"Fit"}]' }];
  expect(await preparePDFContents('/original.pdf', doc)).toBe('generated');
  expect(native.save.mock.calls[0]![2]).toHaveLength(3);
});

it('uses cached OCR geometry when titles and page numbers were recognized as separate columns', async () => {
  native.cache.pages = [1, 4, 8, 12];
  native.read.mockImplementation(async (_id, index: number) => {
    const titles = ['Chapter 1 Copper', 'Chapter 2 Amber', 'Chapter 3 Silver'];
    return {
      index,
      native: false,
      lines:
        index === 1
          ? titles.flatMap((text, i) => [
              { text, x: 0.1, y: 0.2 + i * 0.1, width: 0.4, height: 0.03, endLine: true },
              {
                text: String(1 + i * 4),
                x: 0.85,
                y: 0.2 + i * 0.1,
                width: 0.05,
                height: 0.03,
                endLine: true,
              },
            ])
          : [
              {
                text: titles[[4, 8, 12].indexOf(index)]!,
                x: 0.1,
                y: 0.1,
                width: 0.4,
                height: 0.03,
                endLine: true,
              },
            ],
    };
  });
  expect(await preparePDFContents('/original.pdf', document({}))).toBe('generated');
  expect(native.start).not.toHaveBeenCalled();
});

it('cancels without applying late results and keeps saved recognition', async () => {
  const abort = new AbortController();
  const doc = document({
    1: contents,
    4: 'Chapter 1 Copper',
    8: 'Chapter 2 Amber',
    12: 'Chapter 3 Silver',
  });
  abort.abort();
  await expect(preparePDFContents('/original.pdf', doc, abort.signal)).rejects.toMatchObject({
    name: 'AbortError',
  });
  expect(native.save).not.toHaveBeenCalled();
});

it('recognizes missing scan pages automatically and applies no intermediate draft', async () => {
  const doc = document({}, 16);
  vi.mocked(doc.getPDFText!).mockResolvedValue('');
  native.wait.mockImplementation(async () => {
    expect(native.save).not.toHaveBeenCalled();
    native.read.mockImplementation(async (_id, index: number) => ({
      index,
      native: false,
      lines: (index === 1
        ? contents
        : ({ 4: 'Chapter 1 Copper', 8: 'Chapter 2 Amber', 12: 'Chapter 3 Silver' }[index] ??
          'Ordinary paragraph.')
      )
        .split('\n')
        .map((text, i) => ({
          text,
          x: 0.1,
          y: 0.1 + 0.1 * i,
          width: 0.8,
          height: 0.03,
          endLine: true,
        })),
    }));
    return { state: 'completed' };
  });
  expect(await preparePDFContents('/original.pdf', doc)).toBe('generated');
  const precise = native.start.mock.calls.filter((call) => !call[3]).flatMap((call) => call[2]);
  expect(precise).toEqual(expect.arrayContaining([1, 2, 0, 4, 8, 12]));
  expect(precise.length).toBeLessThanOrEqual(8); // Includes bounded neighbouring folio checks.
  expect(native.save).toHaveBeenCalledTimes(1);
});

it('retains short Chinese headings once the offset has independent evidence', async () => {
  const doc = document({
    1: '目录\n前言 .... 1\n第一章 观察与记录 .... 5\n第二章 来源与核验 .... 9',
    4: '前言',
    8: '第一章 观察与记录',
    12: '第二章 来源与核验',
  });
  expect(await preparePDFContents('/original.pdf', doc)).toBe('generated');
  expect(native.save.mock.calls[0]![2][0]).toMatchObject({ title: '前言', pageIndex: 4 });
});

it('discovers numbered chapter headings across the complete document when no printed TOC exists', async () => {
  const doc = document({ 0: 'Chapter 1 Copper', 9: 'Chapter 2 Amber' }, 30);
  expect(await preparePDFContents('/original.pdf', doc)).toBe('generated');
  expect(doc.getPDFText).toHaveBeenCalledWith(29);
  expect(native.save.mock.calls[0]![2]).toHaveLength(2);
});

it('persists a page-navigation fallback for an embedded outline with unchecked links', async () => {
  const doc = document({});
  doc.toc = [{ id: 0, label: 'Wrong destination', index: 500, href: '[500,{"name":"Fit"}]' }];
  expect(await preparePDFContents('/original.pdf', doc)).toBe('unavailable');
  expect(native.save).toHaveBeenCalledWith(
    '/original.pdf',
    native.cache,
    null,
    16,
    'glossa-pages-1',
  );
});

it('does not replace a result or personal edits when source/revision validation fails', async () => {
  native.save.mockRejectedValue(new Error('pdf_outline_conflict'));
  await expect(
    preparePDFContents(
      '/original.pdf',
      document({
        1: contents,
        4: 'Chapter 1 Copper',
        8: 'Chapter 2 Amber',
        12: 'Chapter 3 Silver',
      }),
    ),
  ).rejects.toThrow('pdf_outline_conflict');
  expect(native.save).toHaveBeenCalledTimes(1);
});

it('cancels a worker that starts after cancellation without waiting or saving', async () => {
  const abort = new AbortController();
  const doc = document({});
  vi.mocked(doc.getPDFText!).mockResolvedValue('');
  native.start.mockImplementation(async () => {
    abort.abort();
    return { cacheId: native.cache.id, state: 'running' };
  });
  await expect(preparePDFContents('/original.pdf', doc, abort.signal)).rejects.toMatchObject({
    name: 'AbortError',
  });
  expect(native.cancel).toHaveBeenCalledWith(native.cache.id);
  expect(native.wait).not.toHaveBeenCalled();
  expect(native.save).not.toHaveBeenCalled();
});

it('can cancel a stalled parser read without waiting for its promise', async () => {
  const abort = new AbortController();
  const doc = document({});
  vi.mocked(doc.getPDFText!).mockImplementation(() => new Promise(() => {}));
  const result = preparePDFContents('/original.pdf', doc, abort.signal);
  await vi.waitFor(() => expect(doc.getPDFText).toHaveBeenCalled());
  abort.abort();
  await expect(result).rejects.toMatchObject({ name: 'AbortError' });
  expect(native.save).not.toHaveBeenCalled();
});

it('does not silently publish a truncated directory when the entry budget is exceeded', async () => {
  const doc = document(
    {
      0:
        'Contents\n' +
        Array.from({ length: 129 }, (_, i) => `Chapter ${i + 1} Original .... ${i + 2}`).join('\n'),
    },
    150,
  );
  expect(await preparePDFContents('/original.pdf', doc)).toBe('unavailable');
  expect(native.save).not.toHaveBeenCalled();
});

it('discovers an explicit contents page after unrelated numbered front matter', async () => {
  const doc = document({
    0: 'Publisher list\nEdition A .... 2\nEdition B .... 5',
    1: contents,
    4: 'Chapter 1 Copper',
    8: 'Chapter 2 Amber',
    12: 'Chapter 3 Silver',
  });
  expect(await preparePDFContents('/original.pdf', doc)).toBe('generated');
  expect(native.save.mock.calls[0]![2]).toHaveLength(3);
});

it('checks chapter numbers on a separate line and stops at the list of illustrations', async () => {
  const doc = document({
    1: contents,
    2: 'List of figures\nFigure A .... 999\nFigure B .... 998',
    4: 'Chapter 1\nCopper',
    8: 'Chapter 2\nAmber',
    12: 'Chapter 3\nSilver',
  });
  expect(await preparePDFContents('/original.pdf', doc)).toBe('generated');
  expect(native.save.mock.calls[0]![2]).toHaveLength(3);
});

it('keeps a missing page-number title and distinguishes its separated heading from running headers', async () => {
  native.cache.pages = [1, 2, 4, 6, 8, 12];
  const word = (text: string, y: number, height = 0.03, x = 0.1, width = 0.5) => ({
    text,
    x,
    y,
    width,
    height,
    endLine: true,
  });
  native.read.mockImplementation(async (_id, index: number) => ({
    index,
    native: false,
    lines:
      index === 1
        ? [
            word('Contents', 0.05, 0.05),
            word('Preface', 0.2),
            word('Chapter 1 Copper', 0.3),
            word('.1', 0.3, 0.03, 0.85, 0.05),
            word('Chapter 2 Amber', 0.4),
            word('5', 0.4, 0.03, 0.85, 0.05),
            word('Chapter 3 Silver', 0.5),
            word(':·9', 0.5, 0.03, 0.85, 0.05),
          ]
        : index === 2
          ? [word('Preface', 0.2), word('Original paragraph', 0.6)]
          : index === 6
            ? [word('Preface', 0.05, 0.015), word('Original paragraph', 0.1)]
            : [
                word(
                  { 4: 'Chapter 1 Copper', 8: 'Chapter 2 Amber', 12: 'Chapter 3 Silver' }[index] ??
                    'Original paragraph',
                  0.2,
                ),
              ],
  }));
  expect(await preparePDFContents('/original.pdf', document({}))).toBe('generated');
  expect(native.save.mock.calls[0]![2].map((row: { pageIndex: number }) => row.pageIndex)).toEqual([
    2, 4, 8, 12,
  ]);
});

it('rejects the entire contents if a title with a missing page number cannot be independently checked', async () => {
  expect(
    await preparePDFContents(
      '/original.pdf',
      document({
        1: contents.replace('Contents', 'Contents\nMissing preface'),
        4: 'Chapter 1 Copper',
        8: 'Chapter 2 Amber',
        12: 'Chapter 3 Silver',
      }),
    ),
  ).toBe('unavailable');
  expect(native.save).not.toHaveBeenCalled();
});

it('uses an embedded contents destination beyond the front window only after checking the page', async () => {
  const doc = document(
    {
      44: '目录\n序 .... 49\n第一部分 1889—1919\n铜与琥珀 .... 53\n白银的来历 .... 57',
      48: '序',
      50: '第一部分 1889—1919',
      52: '铜与琥珀',
      56: '白银的来历',
    },
    80,
  );
  doc.toc = [{ id: 0, label: '目录\u0000', index: 44, href: '[44,{"name":"Fit"}]' }];
  expect(await preparePDFContents('/original.pdf', doc)).toBe('generated');
  expect(native.save.mock.calls[0]![2].map((row: { pageIndex: number }) => row.pageIndex)).toEqual([
    48, 50, 52, 56,
  ]);
});

it('checks every continuation title including one with a missing number', async () => {
  const doc = document({
    1: '目录\n铜与琥珀 .... 5\n白银的来历 .... 9',
    2: '新的开始\n故事的终结 .... 13',
    4: '铜与琥珀',
    8: '白银的来历',
    12: '故事的终结',
  });
  expect(await preparePDFContents('/original.pdf', doc)).toBe('unavailable');
  expect(native.save).not.toHaveBeenCalled();
});

it('pairs compact Chinese TOC numbers and single OCR leader marks only in a confirmed table', async () => {
  const doc = document({
    1: '目录\n序1\n第一章 铜与琥珀 :5\n第二章 白银的来历. 9',
    2: '序',
    6: '第一章\n铜与琥珀',
    10: '第二章\n白银的来历',
  });
  expect(await preparePDFContents('/original.pdf', doc)).toBe('generated');
  expect(native.save.mock.calls[0]![2].map((row: { pageIndex: number }) => row.pageIndex)).toEqual([
    2, 6, 10,
  ]);
});

it('ends a contents table before prose with numeric references and no TOC geometry', async () => {
  const texts = {
    1: contents,
    2: 'Preface\nA prose reference from 2026',
    4: 'Chapter 1 Copper',
    8: 'Chapter 2 Amber',
    12: 'Chapter 3 Silver',
  };
  const doc = document(texts);
  doc.getPDFContentsLines = vi.fn(async (index, all) =>
    index === 2 && !all ? [] : (texts[index as keyof typeof texts] ?? '').split('\n'),
  );
  expect(await preparePDFContents('/original.pdf', doc)).toBe('generated');
  expect(native.save.mock.calls[0]![2]).toHaveLength(3);
});

it('keeps a final compact continuation even when every page token is joined to its title', async () => {
  const texts = {
    1: '目录\n铜与琥珀 5\n白银的来历 9',
    2: '附录.13\n索引.15',
    4: '铜与琥珀',
    8: '白银的来历',
    12: '附录',
    14: '索引',
  };
  const doc = document(texts);
  doc.getPDFContentsLines = vi.fn(async (index, all) =>
    index === 2 && !all ? [] : (texts[index as keyof typeof texts] ?? '').split('\n'),
  );
  expect(await preparePDFContents('/original.pdf', doc)).toBe('generated');
  expect(native.save.mock.calls[0]![2]).toHaveLength(4);
});

it('resolves mixed front-matter folios only through unique independent title evidence', async () => {
  const doc = document({
    1: '目录\n致谢1\n序1\n第一章 铜与琥珀 5\n第二章 白银的来历 9',
    2: '致谢',
    3: '序',
    4: '第一章\n铜与琥珀',
    8: '第二章\n白银的来历',
  });
  expect(await preparePDFContents('/original.pdf', doc)).toBe('generated');
  expect(native.save.mock.calls[0]![2].map((row: { pageIndex: number }) => row.pageIndex)).toEqual([
    2, 3, 4, 8,
  ]);
});

it('checks OCR titles with a trailing footnote and one omitted Han character only with the same chapter number', async () => {
  native.cache.pages = [4, 8];
  native.read.mockImplementation(async (_id, index: number) => ({
    index,
    native: false,
    lines: [
      {
        text: index === 4 ? '第九章 个纯农村的岗位' : '第十章 铜与琥珀的来历①',
        x: 0.1,
        y: 0.2,
        width: 0.8,
        height: 0.03,
        endLine: true,
      },
    ],
  }));
  const doc = document({ 1: '目录\n第九章 一个纯农村的岗位 5\n第十章 铜与琥珀的来历 9' });
  expect(await preparePDFContents('/original.pdf', doc)).toBe('generated');
  native.read.mockImplementation(async (_id, index: number) => ({
    index,
    native: false,
    lines: [
      {
        text: index === 4 ? '第八章 个纯农村的岗位' : '第十章 铜与琥珀的来历①',
        x: 0.1,
        y: 0.2,
        width: 0.8,
        height: 0.03,
        endLine: true,
      },
    ],
  }));
  native.save.mockClear();
  expect(await preparePDFContents('/original.pdf', doc)).toBe('unavailable');
  expect(native.save).not.toHaveBeenCalled();
});

it('recognizes a numbered destination before redirecting it to a cached running header', async () => {
  native.cache.pages = [38];
  const ocr = (index: number, y: number) => ({
    index,
    native: false,
    lines: [{ text: '序言', x: 0.1, y, width: 0.4, height: 0.02, endLine: true }],
  });
  native.read.mockImplementation(async (_id, index: number) =>
    index === 38 ? ocr(38, 0.02) : null,
  );
  native.wait.mockImplementation(async () => {
    native.read.mockImplementation(async (_id, index: number) =>
      ocr(index, index === 38 ? 0.02 : 0.2),
    );
    return { state: 'completed' };
  });
  const doc = document(
    {
      1: '目录\n序言 37\nChapter 2 Amber 49\nChapter 3 Silver 57',
      36: '',
      48: 'Chapter 2 Amber',
      56: 'Chapter 3 Silver',
    },
    80,
  );
  expect(await preparePDFContents('/original.pdf', doc)).toBe('generated');
  expect(native.save.mock.calls[0]![2][0].pageIndex).toBe(36);
});

it('rejects relocation to a lone OCR running header when the numbered target is wrong', async () => {
  native.cache.pages = [38];
  const page = (index: number) => ({
    index,
    native: false,
    lines: [
      {
        text: index === 38 ? '序言' : 'Ordinary paragraph',
        x: 0.1,
        y: index === 38 ? 0.02 : 0.2,
        width: 0.4,
        height: 0.02,
        endLine: true,
      },
    ],
  });
  native.read.mockImplementation(async (_id, index: number) => page(index));
  const doc = document(
    {
      1: '目录\n序言 37\nChapter 2 Amber 49\nChapter 3 Silver 57',
      36: '',
      48: 'Chapter 2 Amber',
      56: 'Chapter 3 Silver',
    },
    80,
  );
  expect(await preparePDFContents('/original.pdf', doc)).toBe('unavailable');
  expect(native.save).not.toHaveBeenCalled();
});

it.each([
  true,
  false,
])('distinguishes a large numbered near-top heading from a small running header (%s)', async (large) => {
  const { doc } = scan(
    {
      0: 'Contents\nChapter 1 Copper .... 1\nChapter 2 Amber .... 2',
      1: 'Chapter 1 Copper\nOriginal subtitle\nOriginal body text\nAnother body line',
      2: 'Chapter 2 Amber',
    },
    4,
  );
  const read = native.read.getMockImplementation()!;
  native.read.mockImplementation(async (...args) => {
    const page: OCRPage | null = await read(...args);
    if (page && args[1] === 1)
      page.lines.forEach((word, i) => {
        word.y = [0.0783, 0.1744, 0.2688, 0.3648][i]!;
        word.height = i === 0 && large ? 0.0309 : 0.025;
      });
    return page;
  });
  expect(await preparePDFContents('/original.pdf', doc)).toBe(large ? 'generated' : 'unavailable');
  if (large)
    expect(
      native.save.mock.calls.at(-1)![2].map((entry: { pageIndex: number }) => entry.pageIndex),
    ).toEqual([1, 2]);
  else expect(native.save).not.toHaveBeenCalled();
});

it('does not trust a false contents bookmark or publish a table cut off at the discovery boundary', async () => {
  const doc = document({ 44: 'An ordinary page', 67: contents }, 80);
  doc.toc = [{ id: 0, label: 'Contents', index: 44, href: '[44,{"name":"Fit"}]' }];
  expect(await preparePDFContents('/original.pdf', doc)).toBe('unavailable');
  expect(native.save.mock.calls.some((call) => call[4] === 'glossa-contents-3')).toBe(false);
});

it('persists page navigation when its own time budget expires without treating it as user cancellation', async () => {
  vi.useFakeTimers();
  const doc = document({});
  doc.toc = [{ id: 0, label: 'Wrong destination', index: 500, href: '[500,{"name":"Fit"}]' }];
  vi.mocked(doc.getPDFText!).mockImplementation(() => new Promise(() => {}));
  const task = preparePDFContents('/original.pdf', doc);
  const stopped = expect(task).rejects.toMatchObject({ name: 'AbortError' });
  try {
    await vi.advanceTimersByTimeAsync(180_000);
    await stopped;
    expect(native.save).toHaveBeenCalledWith(
      '/original.pdf',
      native.cache,
      null,
      16,
      'glossa-pages-1',
    );
  } finally {
    vi.useRealTimers();
  }
});

it('does not abandon an import because another OCR task briefly owns the worker', async () => {
  const doc = document({}, 16);
  vi.mocked(doc.getPDFText!).mockResolvedValue('');
  native.start
    .mockRejectedValueOnce('pdf_ocr_busy')
    .mockResolvedValue({ cacheId: native.cache.id });
  native.wait.mockImplementation(async () => {
    native.read.mockImplementation(async (_id, index: number) => ({
      index,
      native: false,
      lines: (index === 1
        ? contents
        : ({ 4: 'Chapter 1 Copper', 8: 'Chapter 2 Amber', 12: 'Chapter 3 Silver' }[index] ??
          'Ordinary paragraph.')
      )
        .split('\n')
        .map((text, i) => ({
          text,
          x: 0.1,
          y: 0.1 + i * 0.1,
          width: 0.8,
          height: 0.03,
          endLine: true,
        })),
    }));
    return { state: 'completed' };
  });
  expect(await preparePDFContents('/original.pdf', doc)).toBe('generated');
  expect(native.cancel).not.toHaveBeenCalled();
});

it('finds a late printed contents table without an embedded bookmark', async () => {
  const doc = document(
    {
      44: 'Contents\nCopper observations .... 1\nAmber experiments .... 5\nSilver sources .... 9',
      49: 'Copper observations',
      53: 'Amber experiments',
      57: 'Silver sources',
    },
    80,
  );
  expect(await preparePDFContents('/original.pdf', doc)).toBe('generated');
  expect(native.save.mock.calls[0]![2].map((row: { pageIndex: number }) => row.pageIndex)).toEqual([
    49, 53, 57,
  ]);
});

it('calibrates Roman front matter separately from Arabic body pages', async () => {
  const doc = document(
    {
      1: 'Contents\nPreface observations .... iii\nAcknowledgements .... vii\nChapter 1 Copper .... 1\nChapter 2 Amber .... 5',
      30: 'Preface observations',
      34: 'Acknowledgements',
      50: 'Chapter 1 Copper',
      54: 'Chapter 2 Amber',
    },
    80,
  );
  expect(await preparePDFContents('/original.pdf', doc)).toBe('generated');
  expect(native.save.mock.calls[0]![2].map((row: { pageIndex: number }) => row.pageIndex)).toEqual([
    30, 34, 50, 54,
  ]);
});

it('checks accurate scanned embedded destinations before searching for a printed table', async () => {
  const doc = document({}, 120);
  vi.mocked(doc.getPDFText!).mockResolvedValue('');
  doc.toc = [
    { id: 0, label: 'Copper observations', index: 40, href: '[40]' },
    { id: 1, label: 'Amber experiments', index: 90, href: '[90]' },
  ];
  native.wait.mockImplementation(async () => {
    native.read.mockImplementation(async (_id, index: number) => ({
      index,
      native: false,
      lines: [
        {
          text: index === 40 ? 'Copper observations' : 'Amber experiments',
          x: 0.1,
          y: 0.2,
          width: 0.6,
          height: 0.04,
          endLine: true,
        },
      ],
    }));
    return { state: 'completed' };
  });
  expect(await preparePDFContents('/original.pdf', doc)).toBe('preserved');
  expect(native.start.mock.calls.flatMap((call) => call[2])).toEqual([40, 90]);
  expect(native.save).not.toHaveBeenCalled();
});

function scan(texts: Record<number, string>, count: number, coarse = texts) {
  const saved = new Set<number>();
  const detected = new Set<number>();
  native.start.mockImplementation(async (_source, _id, indices: number[], detect: boolean) => {
    for (const index of indices) (detect ? detected : saved).add(index);
    native.cache.pages = [...saved];
    return { cacheId: native.cache.id, state: 'running' };
  });
  native.read.mockImplementation(
    async (_id, index: number, detect = false): Promise<OCRPage | null> => {
      if (!(detect ? detected : saved).has(index)) return null;
      return {
        index,
        native: false,
        lines: ((detect ? coarse : texts)[index] ?? 'Ordinary prose.')
          .split('\n')
          .map((text, i) => ({
            text,
            x: 0.1,
            y: 0.2 + i * 0.06,
            width: 0.8,
            height: 0.025,
            endLine: true,
          })),
      };
    },
  );
  const doc = document({}, count);
  vi.mocked(doc.getPDFText!).mockResolvedValue('');
  return { doc, saved, detected };
}

it.each([
  false,
  true,
])('batches nominated targets after a verified offset and still checks every precise title (wrong final title: %s)', async (wrong) => {
  const texts = {
    1: 'Contents\nCopper observations .... 1\nAmber experiments .... 5\nSilver history .... 9\nGolden history .... 13',
    4: 'Copper observations',
    8: 'Amber experiments',
    12: 'Silver history',
    16: 'Golden history',
  };
  const { doc } = scan({ ...texts, 16: wrong ? 'Unrelated prose' : texts[16] }, 20, texts);
  expect(await preparePDFContents('/original.pdf', doc)).toBe(wrong ? 'unavailable' : 'generated');
  expect(
    native.start.mock.calls.some((call) => !call[3] && !call[4] && call[2].join(',') === '8,12,16'),
  ).toBe(true);
  if (wrong) expect(native.save).not.toHaveBeenCalled();
  else expect(native.save.mock.calls.at(-1)![2]).toHaveLength(4);
});

it.each([
  'table',
  'destination',
] as const)('recovers an incorrect nonempty %s layer using independent precise evidence without replacing reading offsets', async (wrong) => {
  const texts = {
    1: `Contents\n${wrong === 'table' ? '神仙也怕难沩情' : '神仙也怕难为情'} .... 5\n另一段观察 .... 9`,
    4: wrong === 'destination' ? '神仙也怕难沩情' : '神仙也怕难为情',
    8: '另一段观察',
  };
  const { doc, saved } = scan(texts, 16);
  const extra = new Set<number>();
  const start = native.start.getMockImplementation()!;
  const read = native.read.getMockImplementation()!;
  native.start.mockImplementation(async (...args) => {
    if (args[4]) {
      args[2].forEach((index: number) => extra.add(index));
      return { state: 'running' };
    }
    return start(...args);
  });
  native.read.mockImplementation(async (...args) => {
    if (!args[3]) return read(...args);
    if (!extra.has(args[1])) return null;
    const page = (await read(args[0], args[1], false)) as OCRPage;
    return {
      ...page,
      recognizer: 'vision-contents-1',
      lines: page.lines.map((line) => ({ ...line, text: line.text.replace('沩', '为') })),
    };
  });
  const before = structuredClone(texts);
  expect(await preparePDFContents('/original.pdf', doc)).toBe('generated');
  expect(native.save.mock.calls.at(-1)![2]).toEqual([
    { title: '神仙也怕难为情', pageIndex: 4, level: 0 },
    { title: '另一段观察', pageIndex: 8, level: 0 },
  ]);
  expect(extra.has(wrong === 'table' ? 1 : 4)).toBe(true);
  expect(texts).toEqual(before);
  expect([...saved]).toContain(4);
});

it.each([
  true,
  false,
])('uses independent cropped heading passes without joining conflicting readings (complete: %s)', async (complete) => {
  const { doc } = scan(
    {
      1: 'Contents\n神仙也怕难为情 .... 5\n另一段观察 .... 9',
      4: '神仙也怕难沩情',
      8: '另一段观察',
    },
    16,
  );
  const read = native.read.getMockImplementation()!;
  const start = native.start.getMockImplementation()!;
  const cropped = new Set<number>();
  native.start.mockImplementation(async (...args) => {
    if (args[5]) {
      args[2].forEach((index: number) => cropped.add(index));
      return { state: 'running' };
    }
    return start(...args);
  });
  native.read.mockImplementation(async (...args) => {
    if (!args[4]) return read(...args);
    if (!cropped.has(args[1])) return null;
    const page = (await read(args[0], args[1], false)) as OCRPage;
    return {
      ...page,
      recognizer: 'vision-heading-1',
      lines: page.lines.map((line) => ({
        ...line,
        text: complete ? 'Unrelated title' : '神仙也怕',
      })),
      alternatives: [
        page.lines.map((line) => ({ ...line, text: complete ? '神仙也怕难为情' : '难为情' })),
      ],
    };
  });
  expect(await preparePDFContents('/original.pdf', doc)).toBe(
    complete ? 'generated' : 'unavailable',
  );
  expect(cropped.has(4)).toBe(true);
  if (complete)
    expect(native.save.mock.calls.at(-1)![2][0]).toEqual({
      title: '神仙也怕难为情',
      pageIndex: 4,
      level: 0,
    });
  else expect(native.save).not.toHaveBeenCalled();
  expect(((await read(native.cache.id, 4, false)) as OCRPage).lines[0]!.text).toBe(
    '神仙也怕难沩情',
  );
});

it('does not concatenate overlapping TOC readings when precise passes split the same row differently', async () => {
  const { doc } = scan(
    {
      1: 'Contents\nPreface 1\nCopper .... 5\nAmber .... 9',
      2: 'Preface',
      4: 'Copper',
      8: 'Amber',
    },
    16,
  );
  const read = native.read.getMockImplementation()!;
  native.read.mockImplementation(async (...args) => {
    const page = (await read(...args)) as OCRPage | null;
    if (!page || args[1] !== 1 || args[2]) return page;
    const lines = page.lines.map((line) =>
      line.text === 'Preface 1' ? { ...line, width: 0.2 } : line,
    );
    return {
      ...page,
      lines: args[3]
        ? lines.flatMap((line) =>
            line.text === 'Preface 1'
              ? [
                  { ...line, text: 'Preface', width: 0.12 },
                  { ...line, text: '1', x: 0.28, width: 0.02 },
                ]
              : [line],
          )
        : lines,
    };
  });
  expect(await preparePDFContents('/original.pdf', doc)).toBe('generated');
  expect(native.save.mock.calls.at(-1)![2]).toEqual([
    { title: 'Preface', pageIndex: 2, level: 0 },
    { title: 'Copper', pageIndex: 4, level: 0 },
    { title: 'Amber', pageIndex: 8, level: 0 },
  ]);
});

it('retains every original contents row when independent evidence misses a line', async () => {
  const { doc } = scan(
    {
      1: 'Contents\nCopper .... 5\nUnresolved chapter .... 7\nAmber .... 9',
      4: 'Copper',
      8: 'Amber',
    },
    16,
  );
  const read = native.read.getMockImplementation()!;
  native.read.mockImplementation(async (...args) => {
    const page = (await read(...args)) as OCRPage | null;
    return args[3] && page
      ? { ...page, lines: page.lines.filter((line) => !line.text.includes('Unresolved')) }
      : page;
  });
  expect(await preparePDFContents('/original.pdf', doc)).toBe('unavailable');
  expect(native.save).not.toHaveBeenCalled();
});

it.each([
  [false, '004'],
  [true, '004'],
  [false, '002'],
] as const)('recognizes changing marginal folios while retaining interior or ambiguous rows (%s, %s)', async (interior, folio) => {
  const page = (index: number, rows: [string, number][]): OCRPage => ({
    index,
    native: false,
    lines: rows.map(([text, y]) => ({ text, x: 0.1, y, width: 0.7, height: 0.025, endLine: true })),
  });
  const scans = new Map([
    [
      1,
      page(1, [
        ['Contents', 0.15],
        ['Copper .... 5', 0.25],
        ['Amber .... 9', 0.35],
      ]),
    ],
    [
      2,
      page(2, [
        ['002 A history of reading', 0.035],
        ['Silver .... 13', 0.25],
      ]),
    ],
    [
      3,
      page(3, [
        [`${folio} A history of reading`, 0.035],
        ['Gold .... 15', 0.25],
        ...(interior ? [['004 A history of reading', 0.45] as [string, number]] : []),
      ]),
    ],
  ]);
  native.cache.pages = [...scans.keys()];
  native.read.mockImplementation(async (_id, index) => scans.get(index) ?? null);
  const result = await preparePDFContents(
    '/original.pdf',
    document({ 4: 'Copper', 8: 'Amber', 12: 'Silver', 14: 'Gold' }),
  );
  expect(result).toBe(interior || folio === '002' ? 'unavailable' : 'generated');
  if (!interior && folio !== '002') expect(native.save.mock.calls.at(-1)![2]).toHaveLength(4);
  else expect(native.save).not.toHaveBeenCalled();
});

it.each([
  1, 4,
])('recovers a legacy empty OCR checkpoint at page %i instead of treating it as complete', async (legacy) => {
  const { doc, saved } = scan(
    {
      1: 'Contents\nCopper observations .... 5\nAmber experiments .... 9',
      4: 'Copper observations',
      8: 'Amber experiments',
    },
    16,
  );
  saved.add(legacy);
  native.cache.pages = [...saved];
  const read = native.read.getMockImplementation()!;
  const start = native.start.getMockImplementation()!;
  let recovered = false;
  native.read.mockImplementation(async (...args) => {
    if (args[1] === legacy && !args[2] && !recovered)
      return { index: legacy, native: false, lines: [] };
    return read(...args);
  });
  native.start.mockImplementation(async (...args) => {
    if (!args[3] && args[2].includes(legacy)) recovered = true;
    return start(...args);
  });
  expect(await preparePDFContents('/original.pdf', doc)).toBe('generated');
  expect(
    native.start.mock.calls.filter((args) => !args[3] && args[2].includes(legacy)),
  ).toHaveLength(1);
  expect(native.save.mock.calls.at(-1)![2]).toEqual([
    { title: 'Copper observations', pageIndex: 4, level: 0 },
    { title: 'Amber experiments', pageIndex: 8, level: 0 },
  ]);
});

it('never repeatedly retries a current empty checkpoint or upgrades a preview into title evidence', async () => {
  const { doc, saved } = scan(
    {
      1: 'Contents\nCopper observations .... 5\nAmber experiments .... 9',
      4: 'Copper observations',
      8: 'Amber experiments',
    },
    16,
  );
  saved.add(4);
  native.cache.pages = [...saved];
  const read = native.read.getMockImplementation()!;
  native.read.mockImplementation(async (...args) =>
    args[1] === 4 && !args[2]
      ? { index: 4, native: false, lines: [], recognizer: 'vision-multiscale-1' }
      : read(...args),
  );
  expect(await preparePDFContents('/original.pdf', doc)).toBe('unavailable');
  expect(native.start.mock.calls.filter((args) => !args[3] && args[2].includes(4))).toHaveLength(0);
  expect(native.save).not.toHaveBeenCalled();
});

it('uses coarse discovery for a late scanned table and accurate OCR only for its table and targets', async () => {
  const { doc, saved, detected } = scan(
    {
      44: 'Contents\nCopper observations .... 51\nAmber experiments .... 91',
      50: 'Copper observations',
      90: 'Amber experiments',
    },
    120,
  );
  expect(await preparePDFContents('/original.pdf', doc)).toBe('generated');
  expect([...saved]).toEqual([44, 45, 50, 90]);
  expect(detected.has(44)).toBe(true);
  expect(detected.size).toBeLessThan(120);
  expect(native.save.mock.calls[0]![2].map((row: { pageIndex: number }) => row.pageIndex)).toEqual([
    50, 90,
  ]);
  // A retry can reuse both types of page cache without a worker.
  native.start.mockClear();
  expect(await preparePDFContents('/original.pdf', doc)).toBe('generated');
  expect(native.start).not.toHaveBeenCalled();
});

it('never accepts a coarse title as destination evidence', async () => {
  const { doc } = scan(
    {
      1: 'Contents\nCopper observations .... 51\nAmber experiments .... 91',
      50: 'Copper observations',
      90: 'Different title',
    },
    120,
    {
      1: 'Contents\nCopper observations .... 51\nAmber experiments .... 91',
      50: 'Copper observations',
      90: 'Amber experiments',
    },
  );
  expect(await preparePDFContents('/original.pdf', doc)).toBe('unavailable');
  expect(native.save).not.toHaveBeenCalled();
});

it('builds from body headings only after complete coarse discovery, without whole-book accurate OCR', async () => {
  const { doc, saved, detected } = scan({ 5: 'Chapter 1 Copper', 110: 'Chapter 2 Amber' }, 120);
  expect(await preparePDFContents('/original.pdf', doc)).toBe('generated');
  expect(detected.size).toBe(120);
  expect([...saved]).toEqual([5, 110]);
});

it('does not rebuild a complete previous outline when only the routing algorithm changes', async () => {
  native.cache.generator = 'glossa-contents-2';
  native.cache.outline = [
    { title: 'Copper observations', pageIndex: 40, level: 0 },
    { title: 'Amber experiments', pageIndex: 90, level: 0 },
  ];
  const doc = document({ 40: 'Copper observations', 90: 'Amber experiments' }, 120);
  expect(await preparePDFContents('/original.pdf', doc)).toBe('preserved');
  expect(vi.mocked(doc.getPDFText!).mock.calls.map(([index]) => index)).toEqual([40, 90]);
  expect(native.save.mock.calls[0]![2]).toEqual(native.cache.outline);
  expect(native.save.mock.calls[0]![4]).toBe('glossa-contents-3');
});

it('resumes title checks after failure but invalidates changed evidence and verifier versions', async () => {
  const texts = { 1: contents, 4: 'Chapter 1 Copper', 8: 'Chapter 2 Amber', 12: 'Different title' };
  expect(await preparePDFContents('/original.pdf', document(texts))).toBe('unavailable');
  expect(native.save).not.toHaveBeenCalled();
  expect(native.checkpointSave).toHaveBeenCalled();
  native.checkpointSave.mockClear();
  texts[12] = 'Chapter 3 Silver';
  expect(await preparePDFContents('/original.pdf', document(texts))).toBe('generated');
  // Earlier checks were evidence-bound and reused across the failed run.
  expect([...native.checkpoints.values()].at(-1)).toMatchObject({
    entries: expect.arrayContaining([expect.objectContaining({ title: 'Chapter 3 Silver' })]),
  });
  native.save.mockClear();
  texts[4] = 'Changed OCR evidence';
  expect(await preparePDFContents('/original.pdf', document(texts))).toBe('unavailable');
  expect(native.save).not.toHaveBeenCalled();
  texts[4] = 'Chapter 1 Copper';
  for (const [key, value] of native.checkpoints)
    native.checkpoints.set(key, { ...(value as object), verifier: 'obsolete' });
  native.checkpointSave.mockClear();
  expect(await preparePDFContents('/original.pdf', document(texts))).toBe('generated');
  expect([...native.checkpoints.values()].at(-1)).toMatchObject({
    verifier: 'pdf-heading-2',
    entries: expect.any(Array),
  });
  expect(([...native.checkpoints.values()].at(-1) as { entries: unknown[] }).entries).toHaveLength(
    3,
  );
});

it('handles an Arabic page-number restart between front matter and the body', async () => {
  const doc = document(
    {
      1: 'Contents\nPreface observations .... 5\nAcknowledgements .... 9\nChapter 1 Copper .... 1\nChapter 2 Amber .... 5',
      20: 'Preface observations',
      24: 'Acknowledgements',
      50: 'Chapter 1 Copper',
      54: 'Chapter 2 Amber',
    },
    80,
  );
  expect(await preparePDFContents('/original.pdf', doc)).toBe('generated');
  expect(native.save.mock.calls[0]![2].map((row: { pageIndex: number }) => row.pageIndex)).toEqual([
    20, 24, 50, 54,
  ]);
});

it('does not replace an unresolved printed table with a partial set of body headings', async () => {
  const doc = document({
    1: 'Contents\nUnresolved copper chapter\nUnresolved amber chapter',
    4: 'Chapter 1 Copper',
    8: 'Chapter 2 Amber',
  });
  expect(await preparePDFContents('/original.pdf', doc)).toBe('unavailable');
  expect(native.save).not.toHaveBeenCalled();
});

it('does not publish a body-heading list with a missing chapter number', async () => {
  const { doc } = scan({ 5: 'Chapter 1 Copper', 110: 'Chapter 3 Silver' }, 120);
  expect(await preparePDFContents('/original.pdf', doc)).toBe('unavailable');
  expect(native.save).not.toHaveBeenCalled();
});

it('separates contents running folios and the following illustration index before applying the entry budget', async () => {
  const doc = document({
    1: 'Contents\nChapter 1 Copper .... 1\nChapter 2 Amber .... 5',
    2: 'xii Contents\nChapter 3 Silver .... 9',
    3:
      'Illustrations\nMaps\n' +
      Array.from({ length: 130 }, (_, i) => `Figure ${i + 1} .... 1`).join('\n'),
    4: 'Chapter 1 Copper',
    8: 'Chapter 2 Amber',
    12: 'Chapter 3 Silver',
  });
  expect(await preparePDFContents('/original.pdf', doc)).toBe('generated');
  expect(native.save.mock.calls.at(-1)![2]).toEqual([
    { title: 'Chapter 1 Copper', pageIndex: 4, level: 0 },
    { title: 'Chapter 2 Amber', pageIndex: 8, level: 0 },
    { title: 'Chapter 3 Silver', pageIndex: 12, level: 0 },
  ]);
});

it('joins wrapped contents titles and verifies wrapped destination headings without dropping titles missing a page number', async () => {
  const doc = document({
    1: 'Contents\nPreface\nChapter 1 Copper metal\nand amber .... 1\nChapter 2 Silver .... 5',
    3: 'Preface',
    4: 'Chapter 1\nCopper metal\nand amber',
    8: 'Chapter 2 Silver',
  });
  expect(await preparePDFContents('/original.pdf', doc)).toBe('generated');
  expect(native.save.mock.calls.at(-1)![2].map((entry: { title: string }) => entry.title)).toEqual([
    'Preface',
    'Chapter 1 Copper metal and amber',
    'Chapter 2 Silver',
  ]);
});

it('persists the actual failure stage and a bounded reason without publishing a partial outline', async () => {
  const reports: unknown[] = [];
  expect(
    await preparePDFContents(
      '/original.pdf',
      document({ 1: contents, 4: 'Chapter 1 Copper' }),
      undefined,
      (report) => reports.push(report),
    ),
  ).toBe('unavailable');
  expect(reports.at(-1)).toMatchObject({
    stage: 'verification',
    state: 'unavailable',
    code: 'pdf_contents_heading_unverified',
  });
  expect([...native.checkpoints.values()].at(-1)).toMatchObject({
    run: { stage: 'verification', state: 'unavailable', code: 'pdf_contents_heading_unverified' },
  });
  expect(native.save).not.toHaveBeenCalled();
});

it.each([
  'native_text',
  'native_layout',
  'cache_read',
] as const)('records the failing %s operation and page without recording private exception text', async (operation) => {
  const reports: unknown[] = [];
  const doc = document({});
  const failure = new TypeError('/private/book/path: private document text');
  if (operation === 'native_text') vi.mocked(doc.getPDFText!).mockRejectedValue(failure);
  else if (operation === 'native_layout')
    doc.getPDFContentsLines = vi.fn().mockRejectedValue(failure);
  else {
    native.cache.pages = [0];
    native.read.mockRejectedValue(failure);
  }
  await expect(
    preparePDFContents('/original.pdf', doc, undefined, (value) => reports.push(value)),
  ).rejects.toBe(failure);
  expect(reports.at(-1)).toMatchObject({
    stage: 'discovery',
    state: 'failed',
    code: `pdf_contents_${operation}_failed`,
    operation,
    pageIndex: 0,
    errorKind: 'type_error',
  });
  const persisted = JSON.stringify([...native.checkpoints.values()]);
  expect(persisted).toContain(operation);
  expect(persisted).not.toContain('private');
  expect(native.save).not.toHaveBeenCalled();
});

it('does not keep an import waiting for a stalled terminal diagnostic write', async () => {
  vi.useFakeTimers();
  try {
    native.checkpointSave.mockImplementation(async (_key, value) => {
      if (value.run?.state === 'completed') await new Promise(() => {});
    });
    const job = preparePDFContents(
      '/original.pdf',
      document({
        1: contents,
        4: 'Chapter 1 Copper',
        8: 'Chapter 2 Amber',
        12: 'Chapter 3 Silver',
      }),
    );
    await vi.waitFor(() =>
      expect(native.checkpointSave).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ run: expect.objectContaining({ state: 'completed' }) }),
      ),
    );
    await vi.advanceTimersByTimeAsync(1100);
    expect(await job).toBe('generated');
  } finally {
    native.checkpointSave.mockReset();
    vi.useRealTimers();
  }
});

it('records a native OCR failure and resumes an explicit retry using saved page evidence', async () => {
  const reports: unknown[] = [];
  const texts = { 1: contents, 4: 'Chapter 1 Copper', 8: '', 12: 'Chapter 3 Silver' };
  const doc = document(texts);
  native.start.mockRejectedValueOnce('pdf_access_denied');
  await expect(
    preparePDFContents('/original.pdf', doc, undefined, (report) => reports.push(report)),
  ).rejects.toBe('pdf_access_denied');
  expect(reports.at(-1)).toMatchObject({
    stage: 'ocr',
    state: 'failed',
    code: 'pdf_access_denied',
  });
  expect(native.save).not.toHaveBeenCalled();
  texts[8] = 'Chapter 2 Amber';
  expect(await preparePDFContents('/original.pdf', doc)).toBe('generated');
  expect(native.start).toHaveBeenCalledOnce();
  expect(native.save.mock.calls.at(-1)![2]).toHaveLength(3);
});

it('recognizes a Chinese contents label split across OCR lines', async () => {
  const doc = document({
    1: '目\n录\n第一章 铜与琥珀 5\n第二章 白银的来历 9',
    4: '第一章 铜与琥珀',
    8: '第二章 白银的来历',
  });
  expect(await preparePDFContents('/original.pdf', doc)).toBe('generated');
  expect(native.save.mock.calls.at(-1)![2]).toHaveLength(2);
});

it('verifies an explicitly separated Chinese section ordinal without stripping a title word', async () => {
  const texts: Record<number, string> = {
    1: '目录\n铜与琥珀的历史 .... 5\n一生的实验 .... 9',
    4: '一 铜与琥珀的历史',
    8: '生的实验',
  };
  const doc = document(texts);
  expect(await preparePDFContents('/original.pdf', doc)).toBe('unavailable');
  expect(native.save).not.toHaveBeenCalled();
  texts[8] = '一生的实验';
  expect(await preparePDFContents('/original.pdf', doc)).toBe('generated');
});

it('matches the explicit Chinese variant 衞 to 衛 while requiring every other character', async () => {
  const doc = document({
    1: '目录\n第一章 紅衞兵的历史 .... 5\n第二章 白银的历史 .... 9',
    4: '第一章 紅衛兵的历史',
    8: '第二章 白银的历史',
  });
  expect(await preparePDFContents('/original.pdf', doc)).toBe('generated');
});

it('joins a wrapped Chinese chapter title without treating its continuation as a separate chapter', async () => {
  const doc = document({
    1: '目录\n第一章 铜与琥珀的\n历史 .... 5\n第二章 白银的历史 .... 9',
    4: '第一章\n铜与琥珀的历史',
    8: '第二章 白银的历史',
  });
  expect(await preparePDFContents('/original.pdf', doc)).toBe('generated');
  expect(native.save.mock.calls.at(-1)![2]).toHaveLength(2);
});

it('treats a Roman part number as a heading and checks the illustration-list destination by its actual heading', async () => {
  const doc = document({
    1: 'Contents\nList of illustrations .... iii\nPart I\nCopper and amber .... 1\nChapter 1 Silver .... 5',
    3: 'Illustrations\nMaps',
    4: 'Part I\nCopper and amber',
    8: 'Chapter 1 Silver',
  });
  doc.getPDFContentsLayout = async (index) =>
    index === 1
      ? [
          { text: 'Part I', x: 0.1, y: 0.2, height: 0.025, width: 0.2 },
          { text: 'Copper and amber .... 1', x: 0.1, y: 0.23, height: 0.025, width: 0.7 },
          { text: 'Chapter 1 Silver .... 5', x: 0.15, y: 0.4, height: 0.02, width: 0.7 },
        ]
      : [];
  expect(await preparePDFContents('/original.pdf', doc)).toBe('generated');
  expect(native.save.mock.calls.at(-1)![2]).toEqual([
    { title: 'List of illustrations', pageIndex: 3, level: 0 },
    { title: 'Part I Copper and amber', pageIndex: 4, level: 0 },
    { title: 'Chapter 1 Silver', pageIndex: 8, level: 1 },
  ]);
});

it('confirms a geometric TOC candidate whose coarse label is corrupted before scanning the rest of a long book', async () => {
  const rows =
    'Copper observations .... 51\nAmber experiments .... 71\nSilver results .... 91\nGold conclusions .... 111';
  const { doc, detected } = scan(
    {
      4: `目录\n${rows}`,
      50: 'Copper observations',
      70: 'Amber experiments',
      90: 'Silver results',
      110: 'Gold conclusions',
    },
    300,
    {
      4: `目\n鎵\n${rows}`,
      50: 'Copper observations',
      70: 'Amber experiments',
      90: 'Silver results',
      110: 'Gold conclusions',
    },
  );
  expect(await preparePDFContents('/original.pdf', doc)).toBe('generated');
  expect(detected.size).toBeLessThan(32);
  expect(native.save.mock.calls.at(-1)![2]).toHaveLength(4);
});

it('relocates a scanned chapter with its number above a separate interior title while rejecting running headers', async () => {
  const titles = ['第一章 铜与琥珀的历史', '第二章 白银的历史'];
  const { doc } = scan(
    {
      1: `目录\n${titles[0]} .... 1\n${titles[1]} .... 5`,
      7: '第一章\n铜与琥珀的历史',
      11: titles[1]!,
    },
    20,
  );
  const read = native.read.getMockImplementation()!;
  native.read.mockImplementation(async (...args) => {
    const page: OCRPage | null = await read(...args);
    if (page && args[1] === 7)
      page.lines.forEach((line, i) => {
        line.y = [0.16, 0.23][i]!;
      });
    return page;
  });
  expect(await preparePDFContents('/original.pdf', doc)).toBe('generated');
  expect(
    native.save.mock.calls.at(-1)![2].map((entry: { pageIndex: number }) => entry.pageIndex),
  ).toEqual([7, 11]);
});
