import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  buildAnnotationUrl,
  parseAnnotationDeepLink,
  parseBookDeepLink,
} from '../../utils/deeplink';

describe('buildAnnotationUrl', () => {
  const link = { bookHash: 'abc', noteId: 'n1', cfi: '/6/4!/4/2' };

  it('builds the custom-scheme app URL when linkType is "app"', () => {
    const url = buildAnnotationUrl(link, 'app');
    expect(url.startsWith('glossa://book/abc/annotation/n1')).toBe(true);
  });

  it('builds the HTTPS web URL when linkType is "web"', () => {
    const url = buildAnnotationUrl(link, 'web');
    expect(url.startsWith('https://')).toBe(true);
    expect(url).toContain('/o/book/abc/annotation/n1');
  });

  it('preserves the cfi query for both link types', () => {
    const encoded = encodeURIComponent(link.cfi);
    expect(buildAnnotationUrl(link, 'app')).toContain(`cfi=${encoded}`);
    expect(buildAnnotationUrl(link, 'web')).toContain(`cfi=${encoded}`);
  });

  it('omits the cfi query when no cfi is provided', () => {
    const url = buildAnnotationUrl({ bookHash: 'abc', noteId: 'n1' }, 'app');
    expect(url).toBe('glossa://book/abc/annotation/n1');
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Glossa deep links and existing notes', () => {
  it.each(['glossa', 'glossa-dev', 'readest'])('accepts %s annotation and book links', (scheme) => {
    expect(parseAnnotationDeepLink(`${scheme}://book/abc/annotation/n1`)).toEqual({
      bookHash: 'abc',
      noteId: 'n1',
      cfi: undefined,
    });
    expect(parseBookDeepLink(`${scheme}://book/abc`)).toEqual({ bookHash: 'abc' });
  });

  it('exports links for the isolated development app', () => {
    vi.stubEnv('NEXT_PUBLIC_GLOSSA_RUNTIME_ID', 'app.glossa.reader.dev');
    expect(buildAnnotationUrl({ bookHash: 'abc', noteId: 'n1' }, 'app')).toBe(
      'glossa-dev://book/abc/annotation/n1',
    );
  });
});
