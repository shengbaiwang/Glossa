import { expect, it } from 'vitest';
import { orderedOCR, ocrText } from 'foliate-js/pdf-ocr.js';

const word = (text: string, x: number, y: number, width = 0.3) => ({
  text,
  x,
  y,
  width,
  height: 0.025,
  endLine: true,
});

it('pairs detached contents page labels with visual rows without rewriting the OCR cache', () => {
  const lines = [
    word('First chapter', 0.1, 0.1),
    word('Second chapter', 0.1, 0.2),
    word('………１２', 0.75, 0.102, 0.15),
    word('···24', 0.75, 0.198, 0.15),
  ];
  const page = { native: false, lines };
  const original = structuredClone(page);
  expect(ocrText(page)).toBe('First chapter………１２\nSecond chapter···24\n');
  expect(page).toEqual(original);
});

it('keeps ordinary multi-column prose in its original block order', () => {
  const lines = [
    word('Left first.', 0.1, 0.1),
    word('Left second.', 0.1, 0.2),
    word('Right first.', 0.6, 0.1),
    word('Right second.', 0.6, 0.2),
  ];
  expect(orderedOCR({ lines })).toBe(lines);
});

it('does not reorder a page because of a single detached number or native text', () => {
  const lines = [word('First.', 0.1, 0.1), word('Second.', 0.1, 0.2), word('12', 0.8, 0.1, 0.04)];
  expect(orderedOCR({ lines })).toBe(lines);
  expect(ocrText({ native: true, lines })).toBe('');
});
