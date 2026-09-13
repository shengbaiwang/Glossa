import { describe, expect, it } from 'vitest';
import { sanitizeDictionaryHtml } from '@/services/dictionaries/sanitize';
describe('dictionary markup', () => {
  it('removes active content while preserving entry navigation', () => {
    const html = sanitizeDictionaryHtml(
      '<script>alert(1)</script><img src="x" onerror="alert(1)"><a href="javascript:alert(1)">bad</a><a href="entry://word">word</a>',
    );
    expect(html).not.toMatch(/script|onerror|javascript/);
    expect(html).toContain('entry://word');
  });
});
