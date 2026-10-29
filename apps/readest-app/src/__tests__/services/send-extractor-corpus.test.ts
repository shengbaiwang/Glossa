import { describe, expect, test } from 'vitest';
import Defuddle from 'defuddle';
import { Readability } from '@mozilla/readability';
import { sanitizeForParsing } from '@/utils/sanitize';
import { extractWebArticle } from '@/services/send/conversion/extractWebArticle';
import { webArticleCorpus } from '../fixtures/webArticleCorpus';

const textContent = (html: string): string =>
  new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '';

describe('fixed original web article corpus', () => {
  test.each(webArticleCorpus)('keeps annotated article content: $name', ({ html, required }) => {
    const article = extractWebArticle(html, 'https://example.com/field');
    const text = textContent(article.content);
    for (const marker of required) expect(text).toContain(marker);
    expect(text).not.toContain('Navigation marker');
    expect(text).not.toContain('Footer marker');
  });

  test('compares both synchronous engines against annotated content', () => {
    const scores = { defuddle: 0, readability: 0 };
    for (const fixture of webArticleCorpus) {
      const doc = () =>
        new DOMParser().parseFromString(sanitizeForParsing(fixture.html), 'text/html');
      const outputs = {
        defuddle: new Defuddle(doc(), {
          url: 'https://example.com/field',
          useAsync: false,
          removeSmallImages: false,
        }).parse().content,
        readability: new Readability(doc(), { keepClasses: true }).parse()?.content ?? '',
      };
      for (const engine of ['defuddle', 'readability'] as const) {
        const text = textContent(outputs[engine]);
        if (
          fixture.required.every((marker) => text.includes(marker)) &&
          !text.includes('Navigation marker') &&
          !text.includes('Footer marker')
        )
          scores[engine]++;
      }
    }
    console.info('Original extraction corpus (content + chrome annotations)', {
      samples: webArticleCorpus.length,
      ...scores,
    });
    expect(scores.defuddle).toBeGreaterThanOrEqual(scores.readability);
    expect(scores.defuddle).toBeGreaterThanOrEqual(10);
  });
});
