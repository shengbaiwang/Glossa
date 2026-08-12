import { describe, expect, test } from 'vitest';

import { resolveEpubTextQuote } from '@/glossa/context/epubNavigation';

const makeDocument = (html: string) => {
  const doc = document.implementation.createHTMLDocument('anchor resolution');
  doc.body.innerHTML = html;
  return doc;
};

describe('EPUB TextQuote resolution', () => {
  test('recovers one exact English quote', () => {
    const doc = makeDocument('<p>Before the exact amber mark appears after the margin.</p>');
    const result = resolveEpubTextQuote(doc, {
      exact: 'exact amber mark',
      prefix: 'Before the ',
      suffix: ' appears after',
    });

    expect(result.status).toBe('matched');
    if (result.status === 'matched') expect(result.range.toString()).toBe('exact amber mark');
  });

  test('uses prefix and suffix to disambiguate duplicate exact quotes', () => {
    const doc = makeDocument(`
      <p>The first amber mark closes here.</p>
      <p>The later amber mark supplies evidence.</p>
    `);
    const result = resolveEpubTextQuote(doc, {
      exact: 'amber mark',
      prefix: 'The later ',
      suffix: ' supplies evidence',
    });

    expect(result.status).toBe('matched');
    if (result.status === 'matched') {
      expect(result.range.startContainer.parentElement?.textContent).toContain('later amber mark');
    }
  });

  test('refuses tied duplicate candidates instead of choosing the first', () => {
    const doc = makeDocument('<p>amber mark</p><p>amber mark</p>');

    expect(resolveEpubTextQuote(doc, { exact: 'amber mark' })).toEqual({ status: 'ambiguous' });
  });

  test('returns not-found for a substantive text difference', () => {
    const doc = makeDocument('<p>The amber symbol is different.</p>');

    expect(resolveEpubTextQuote(doc, { exact: 'amber mark' })).toEqual({ status: 'not-found' });
  });

  test('ignores script, style, template, nav, hidden, aria-hidden, and invisible text', () => {
    const doc = makeDocument(`
      <script>forbidden quote</script>
      <style>.x::after { content: 'forbidden quote'; }</style>
      <template>forbidden quote</template>
      <nav>forbidden quote</nav>
      <p hidden>forbidden quote</p>
      <p aria-hidden="true">forbidden quote</p>
      <p style="display: none">forbidden quote</p>
      <p style="visibility: hidden">forbidden quote</p>
      <p>trusted quote</p>
    `);

    expect(resolveEpubTextQuote(doc, { exact: 'forbidden quote' })).toEqual({
      status: 'not-found',
    });
    expect(resolveEpubTextQuote(doc, { exact: 'trusted quote' }).status).toBe('matched');
  });

  test('recovers Chinese and Unicode text split across equivalent inline nodes', () => {
    const doc = makeDocument(
      '<p>回读信号会把读者从<span>共享页边</span>带回确切的琥珀色标记。</p>',
    );
    const result = resolveEpubTextQuote(doc, { exact: '读者从共享页边带回确切' });

    expect(result.status).toBe('matched');
    if (result.status === 'matched') expect(result.range.toString()).toBe('读者从共享页边带回确切');
  });

  test('allows ordinary whitespace reflow without ignoring word differences', () => {
    const doc = makeDocument('<p>The Aster\n  Index records\t every amber mark.</p>');
    const result = resolveEpubTextQuote(doc, { exact: 'Aster Index records every amber mark' });

    expect(result.status).toBe('matched');
    if (result.status === 'matched') {
      expect(result.range.toString()).toMatch(/Aster\n {2}Index records\t every amber mark/u);
    }
    expect(resolveEpubTextQuote(doc, { exact: 'Aster Index replaces every amber mark' })).toEqual({
      status: 'not-found',
    });
  });

  test('does not combine text from separate chapter documents', () => {
    const first = makeDocument('<p>shared margin back to</p>');
    const second = makeDocument('<p>the exact amber mark</p>');

    expect(
      resolveEpubTextQuote(first, { exact: 'shared margin back to the exact amber mark' }),
    ).toEqual({ status: 'not-found' });
    expect(
      resolveEpubTextQuote(second, { exact: 'shared margin back to the exact amber mark' }),
    ).toEqual({ status: 'not-found' });
  });
});
