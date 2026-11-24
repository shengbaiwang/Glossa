import { expect, it } from 'vitest';
import { alignContentsTargets } from '@/services/pdfContentsAlignment';
import { parseOCRPage } from '@/services/pdfEnhancement';

const entry = (title: string, pageIndex: number, level = 0) => ({ title, pageIndex, level });

it('resolves competing targets by physical order and permits a chapter and section on one page', () => {
  const chapter = entry('Copper', 3);
  const section = entry('Patina', 3, 1);
  const next = entry('Amber', 5);
  expect(alignContentsTargets([[chapter, entry('Copper', 9)], [section], [next]])).toEqual([
    chapter,
    section,
    next,
  ]);
});

it('keeps ambiguity and missing rows from becoming a smaller published outline', () => {
  expect(
    alignContentsTargets([[entry('Copper', 2), entry('Copper', 3)], [entry('Amber', 4)]]),
  ).toBe('ambiguous');
  expect(alignContentsTargets([[entry('Copper', 3)], [], [entry('Amber', 4)]])).toBe('none');
});

it('recovers subpixel legacy detection drift without weakening precise reading boxes', () => {
  const page = {
    index: 2,
    native: false,
    lines: [{ text: 'Copper', x: -1.2e-9, y: 0.3, width: 0.4, height: 0.03, endLine: true }],
  };
  expect(parseOCRPage(page, 2, true)?.lines[0]?.x).toBe(0);
  expect(parseOCRPage(page, 2)).toBeNull();
  page.lines[0]!.x = -0.01;
  expect(parseOCRPage(page, 2, true)).toBeNull();
});

it('resolves insertion offsets across unnumbered rows, and treats a numbering restart separately', () => {
  const early = entry('Copper', 10);
  const insert = entry('Illustrations', 18);
  const later = entry('Amber', 21);
  const restart = entry('Appendix', 23);
  const folios = [{ group: 0, printed: 1 }, undefined, { group: 0, printed: 10 }];
  expect(alignContentsTargets([[early, entry('Copper', 15)], [insert], [later]], folios)).toEqual([
    early,
    insert,
    later,
  ]);
  expect(alignContentsTargets([[early, entry('Copper', 11)], [insert], [later]], folios)).toBe(
    'ambiguous',
  );
  expect(
    alignContentsTargets(
      [[early], [insert], [later], [restart]],
      [...folios, { group: 1, printed: 20 }],
    ),
  ).toEqual([early, insert, later, restart]);
});

it('permits a verified missing-leaf discontinuity with independent anchors on both sides', () => {
  const numbers = [901, 905, 909, 913];
  const pages = [4, 8, 10, 14];
  expect(
    alignContentsTargets(
      pages.map((page, i) => [entry(`Heading ${i}`, page)]),
      numbers.map((printed) => ({ group: 0, printed })),
    ),
  ).toEqual(pages.map((page, i) => entry(`Heading ${i}`, page)));
});

it('does not invent a negative discontinuity from a single contrary target', () => {
  expect(
    alignContentsTargets(
      [[entry('Copper', 4)], [entry('Amber', 6)]],
      [
        { group: 0, printed: 901 },
        { group: 0, printed: 905 },
      ],
    ),
  ).toBe('none');
});
