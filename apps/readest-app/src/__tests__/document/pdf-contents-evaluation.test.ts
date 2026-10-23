import { expect, it } from 'vitest';
import { evaluateContents, classifyFailure } from '../../../scripts/pdf-contents-eval/metrics';

const expected = [
  { title: 'Chapter 1 Copper', pageIndex: 4, level: 0 },
  { title: 'Chapter 2 Amber', pageIndex: 8, level: 0 },
  { title: 'Chapter 3 Silver', pageIndex: 12, level: 1 },
];
it('counts omissions, extra entries, wrong destinations and wrong hierarchy independently', () => {
  expect(
    evaluateContents(
      expected,
      [
        { ...expected[0]!, pageIndex: 5 },
        { ...expected[2]!, level: 0 },
        { title: 'Illustrations', pageIndex: 15, level: 0 },
      ],
      true,
    ),
  ).toEqual({
    expected: 3,
    published: 3,
    correct: 0,
    missing: 1,
    extra: 1,
    wrongPage: 1,
    wrongLevel: 1,
    wrongParent: 1,
    complete: false,
  });
});
it('does not turn an unaudited reference or an empty expectation into a quality claim', () => {
  expect(evaluateContents(expected, expected, false).complete).toBeNull();
  expect(evaluateContents([], [], false).complete).toBeNull();
  expect(evaluateContents(expected, [], true).missing).toBe(3);
});
it('matches repeated titles one to one and preserves strict title content', () => {
  const repeated = [
    { title: 'Notes', pageIndex: 4, level: 0 },
    { title: 'Notes', pageIndex: 8, level: 0 },
  ];
  expect(evaluateContents(repeated, [repeated[0]!], true).missing).toBe(1);
  expect(
    evaluateContents(expected, [{ ...expected[0]!, title: 'Chapter 1 C0pper' }], true).missing,
  ).toBe(3);
  expect(
    evaluateContents(
      expected,
      expected.map((e) => ({ ...e, title: e.title.replaceAll(' ', '\n') })),
      true,
    ).complete,
  ).toBe(true);
});

it('rejects the wrong owning part even when every title, page and numeric level matches', () => {
  const parts = [
    { title: 'Part I', pageIndex: 1, level: 0 },
    { title: 'Copper', pageIndex: 2, level: 1 },
    { title: 'Part II', pageIndex: 3, level: 0 },
    { title: 'Silver', pageIndex: 4, level: 1 },
  ];
  const misplaced = [parts[0]!, parts[2]!, parts[1]!, parts[3]!];
  const result = evaluateContents(parts, misplaced, true);
  expect(result).toMatchObject({ wrongPage: 0, wrongLevel: 0, wrongParent: 1, complete: false });
});
it('distinguishes observed failures without guessing OCR or mapping from an unverified title', () => {
  expect(classifyFailure({ code: 'pdf_contents_heading_unverified', stage: 'verification' })).toBe(
    'verification',
  );
  expect(classifyFailure({ code: 'pdf_contents_order', stage: 'verification' })).toBe('mapping');
  expect(classifyFailure({ code: 'pdf_contents_timeout', stage: 'ocr' })).toBe('timeout');
  expect(classifyFailure({ code: 'pdf_contents_fine_ocr_failed', stage: 'ocr' })).toBe(
    'recognition',
  );
  expect(classifyFailure({ code: 'pdf_contents_native_text_failed', stage: 'discovery' })).toBe(
    'runtime',
  );
  expect(classifyFailure({ code: 'pdf_contents_not_found', stage: 'discovery' })).toBe('discovery');
  expect(classifyFailure({ code: 'pdf_contents_entry_limit', stage: 'extraction' })).toBe('limit');
  expect(classifyFailure({ code: 'pdf_contents_incomplete', stage: 'extraction' })).toBe(
    'extraction',
  );
  expect(classifyFailure({ code: 'pdf_contents_failed', stage: 'save' })).toBe('save');
  expect(classifyFailure(undefined)).toBe('unknown');
});
