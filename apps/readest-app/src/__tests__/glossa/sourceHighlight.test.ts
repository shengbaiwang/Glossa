import { afterEach, expect, it, vi } from 'vitest';
import { highlightSource } from '@/glossa/citations/highlight';
import type { FoliateView } from '@/types/view';

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  document.head.querySelectorAll('style').forEach((style) => style.remove());
});

function fixture() {
  const p = document.createElement('p');
  p.textContent = 'Before. Cited passage. After.';
  document.body.append(p);
  const range = document.createRange();
  range.setStart(p.firstChild!, 8);
  range.setEnd(p.firstChild!, 22);
  const view = Object.assign(document.createElement('div'), {
    resolveCFI: () => ({ index: 0, anchor: () => range }),
    renderer: { getContents: () => [{ index: 0, doc: document }] },
  }) as unknown as FoliateView;
  const registry = new Map();
  vi.stubGlobal('CSS', { ...CSS, highlights: registry });
  vi.stubGlobal(
    'Highlight',
    class extends Set<Range> {
      constructor(...ranges: Range[]) {
        super(ranges);
      }
    },
  );
  return {
    view,
    registry,
    p,
    source: { cfi: 'verified', text: 'Cited passage.', recovered: false },
  };
}

it('paints exactly the verified range without changing text nodes or native selection and clears on reading movement', () => {
  const { view, registry, p, source } = fixture();
  const originalNode = p.firstChild;
  highlightSource(view, source);
  expect([...registry.get('glossa-source')].map((range: Range) => range.toString())).toEqual([
    'Cited passage.',
  ]);
  expect(p.firstChild).toBe(originalNode);
  expect(document.getSelection()?.toString()).toBe('');
  view.dispatchEvent(new Event('relocate'));
  expect(registry.has('glossa-source')).toBe(false);
  expect(document.head.querySelector('style')).toBeNull();
});

it('does not highlight a rendered range with different text', () => {
  const { view, registry, source } = fixture();
  highlightSource(view, { ...source, text: 'Something else' });
  expect(registry.size).toBe(0);
});

it('cleans up only its own paint layer when a newer citation has replaced it', () => {
  const { view, registry, source } = fixture();
  const clearFirst = highlightSource(view, source);
  const clearSecond = highlightSource(view, source);
  clearFirst();
  expect(registry.has('glossa-source')).toBe(true);
  clearSecond();
  expect(registry.size).toBe(0);
  expect(document.head.querySelector('style')).toBeNull();
});

it('gracefully keeps the source panel usable on engines without CSS highlights', () => {
  const { view, source } = fixture();
  vi.stubGlobal('Highlight', undefined);
  expect(() => highlightSource(view, source)()).not.toThrow();
  expect(document.head.querySelector('style')).toBeNull();
});
