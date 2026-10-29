import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { convertPageToEpub } from '@/services/send/conversion/convertToEpub';
import Defuddle from 'defuddle';
import { Readability } from '@mozilla/readability';
import { extractWebArticle } from '@/services/send/conversion/extractWebArticle';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline test')));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function epubText(file: File, name: string): Promise<string> {
  const { BlobReader, TextWriter, ZipReader } = await import('@zip.js/zip.js');
  const reader = new ZipReader(new BlobReader(file));
  try {
    const entry = (await reader.getEntries()).find((item) => item.filename === name);
    if (!entry || !('getData' in entry) || !entry.getData) throw new Error(`Missing ${name}`);
    return await entry.getData(new TextWriter());
  } finally {
    await reader.close();
  }
}

describe('web article conversion integrity', () => {
  test.each([
    {
      name: 'author resource appendices',
      opening:
        '<p>The field equipment was selected after several seasons of observations. This article records the final choice.</p>',
      original:
        '<h2>Appendix</h2><ul><li><a href="/supplier-one">First field instrument supplier</a></li><li><a href="/supplier-two">Second notebook publisher</a></li></ul>',
      retained: '',
      markers: ['First field instrument supplier', 'Second notebook publisher'],
    },
    {
      name: 'nested tutorial sections and calculator code',
      opening:
        '<p>This tutorial introduces the language through complete examples and exercises. Work through each section in order.</p>',
      original:
        '<section><h2>3.1 Calculations</h2><section><h3>3.1.1 Whole numbers</h3><p>The interpreter evaluates arithmetic expressions from left to right.</p><pre><code>&gt;&gt;&gt; 6 * 7\n42</code></pre></section></section><section><h2>3.2 Next steps</h2><p>Continue by defining a function and repeating the calculation.</p></section>',
      retained:
        '<section><h2>3.2 Next steps</h2><p>Continue by defining a function and repeating the calculation.</p></section>',
      markers: ['3.1 Calculations', '3.1.1 Whole numbers', '6 * 7', '42'],
    },
    {
      name: 'reference text outside paragraph elements',
      opening:
        '<p>The survey compares two original reports and records their complete bibliographic details below.</p>',
      original:
        '<h2>References</h2><ol class="references"><li id="ref1"><span class="order">1.</span> Chen L. Field measurements and uncertainty. River Studies. 2024; 9: 12–28.<ul><li><a href="/reference">View article</a></li></ul></li></ol>',
      retained:
        '<h2>References</h2><ol><li id="ref1">1.<ul><li><a href="/reference">View article</a></li></ul></li></ol>',
      markers: ['Chen L. Field measurements and uncertainty. River Studies. 2024; 9: 12–28.'],
    },
    {
      name: 'explanatory sidebars and accuracy cautions',
      opening:
        '<p>The main text describes the measurement technique and introduces the constraints on interpreting the results.</p>',
      original:
        '<aside class="caution"><p>This report is historical; newer instruments use a different calibration protocol.</p></aside><aside class="sidebar"><h2>How large is one sample?</h2><p>A sample represents the full interval between two recorded observations.</p></aside>',
      retained: '',
      markers: [
        'newer instruments use a different calibration protocol',
        'How large is one sample?',
        'full interval between two recorded observations',
      ],
    },
  ])('retains complete semantic $name when a primary candidate omits it', ({
    opening,
    original,
    retained,
    markers,
  }) => {
    const body = `<h1>Field guide</h1>${opening}<p>${'The team documents its observations carefully and keeps the original records. '.repeat(5)}</p>`;
    vi.spyOn(Defuddle.prototype, 'parse').mockReturnValue({
      content: `${body}${retained}`,
      title: 'Field guide',
      author: '',
    } as ReturnType<Defuddle['parse']>);
    const html = `<title>Field guide</title><nav><a href="/home">Site navigation marker</a></nav><article>${body}${original}<aside aria-label="Navigation"><a href="/news">Unrelated news navigation</a><a href="/shop">Shop navigation</a></aside></article>`;
    const result = extractWebArticle(html, 'https://example.com/guide');
    for (const marker of markers) expect(result.content).toContain(marker);
    expect(result.content).not.toContain('Site navigation marker');
    expect(result.content).not.toContain('Unrelated news navigation');
    const resultDoc = new DOMParser().parseFromString(result.content, 'text/html');
    expect(
      Array.from(resultDoc.querySelectorAll('h2,h3')).map((heading) => heading.textContent),
    ).toEqual(
      Array.from(
        new DOMParser().parseFromString(original, 'text/html').querySelectorAll('h2,h3'),
      ).map((heading) => heading.textContent),
    );
  });

  test('preserves section hierarchy in the EPUB3 navigation used by the reader', async () => {
    const paragraph = 'The station observations describe the changing river level. '.repeat(8);
    const html = `<title>Field report</title><article><h1>Field report</h1><p>${paragraph}</p><h2>Measurements</h2><p>${paragraph}</p><h3>Calibration</h3><p>${paragraph}</p></article>`;
    const result = await convertPageToEpub(html, 'https://example.com/report');
    const nav = new DOMParser().parseFromString(
      await epubText(result.file, 'nav.xhtml'),
      'application/xhtml+xml',
    );
    expect(nav.querySelector('nav > ol > li > ol > li > ol > li > a')?.textContent).toBe(
      'Calibration',
    );
  });

  test('does not persist absolute local source paths inside a generated EPUB', async () => {
    const html =
      '<title>Field notebook</title><article><h1>Field notebook</h1><p>The observation is complete and is saved in this local notebook.</p></article>';
    const result = await convertPageToEpub(
      html,
      'file:///Users/private-person/Documents/notebook.html',
    );
    const source = await epubText(result.file, 'source.json');
    const opf = await epubText(result.file, 'content.opf');
    expect(source).not.toContain('/Users/private-person');
    expect(opf).not.toContain('/Users/private-person');
  });

  test('does not run backup engines once ordinary article extraction passes', () => {
    const backup = vi.spyOn(Readability.prototype, 'parse');
    const html = `<title>Field observations</title><article><h1>Field observations</h1><p>${'The team recorded water levels at three stations. '.repeat(12)}</p></article>`;
    expect(extractWebArticle(html, 'https://example.com/field').source.extractor).toBe(
      'defuddle@0.19.6',
    );
    expect(backup).not.toHaveBeenCalled();
  });

  test('rejects explicit unavailable-page screens while preserving articles about HTTP errors', () => {
    const screen =
      '<title>Page not found | Journal</title><h1>404</h1><p>The requested page is unavailable. Browse the index or return to the homepage.</p>';
    expect(() => extractWebArticle(screen, 'https://example.com/missing')).toThrow(
      /unavailable|not found/i,
    );
    const article =
      '<title>Understanding HTTP errors</title><article><h1>Understanding HTTP errors</h1><p>A 404 response means the requested resource was not found. This note explains how to diagnose an incorrect route.</p></article>';
    expect(extractWebArticle(article, 'https://example.com/http').content).toContain(
      'diagnose an incorrect route',
    );
  });

  test('packages image-led articles but rejects an empty result when all their images fail', async () => {
    const html =
      '<title>Visual field notebook</title><article><h1>Visual field notebook</h1><figure><img src="/field.png" alt="Field sketch"></figure></article>';
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    vi.mocked(fetch).mockResolvedValue(
      new Response(png, { headers: { 'content-type': 'image/png' } }),
    );
    const result = await convertPageToEpub(html, 'https://example.com/visual', undefined, {
      captureMethod: 'browser',
    });
    expect(result).toMatchObject({ source: { captureMethod: 'browser' } });
    expect(await epubText(result.file, 'OEBPS/chapter1.xhtml')).toContain('src="images/');
    vi.mocked(fetch).mockRejectedValue(new Error('offline'));
    await expect(convertPageToEpub(html, 'https://example.com/visual')).rejects.toMatchObject({
      code: 'parse_failed',
    });
  });

  test('rejects account onboarding shells without mistaking an article login form for its body', () => {
    const shells = [
      '<title>Community</title><h1>See what is happening</h1><form action="/i/onboarding/web"><input type="text"><button>Continue with phone</button><p>By continuing, you agree to the service terms and privacy policy.</p></form><p>Already have an account?</p><a href="/login">Sign in</a>',
      '<title>问答社区</title><form class="SignFlow Login-content"><input type="tel"><button>获取短信验证码</button><button>登录/注册</button><div>未注册手机验证后自动登录，注册即代表同意协议和隐私指引。</div></form><footer>关于我们，联系我们，网站备案，著作权声明和其他服务说明。</footer>',
    ];
    for (const html of shells)
      expect(() => extractWebArticle(html, 'https://example.com/home')).toThrow(/login wall/i);
    const real = `<title>Field journal</title><article><h1>Field journal</h1><p>${'An observer recorded the changing water level at the station. '.repeat(8)}</p></article>${shells[0]}`;
    expect(extractWebArticle(real, 'https://example.com/journal').content).toContain(
      'changing water level',
    );
  });

  test('labels scholarly abstract pages and exposes the declared PDF without downloading it', async () => {
    const html = `<html><head><meta name="citation_title" content="River observations"><meta name="citation_pdf_url" content="/papers/river.pdf"></head><body>
      <main><h1>River observations</h1><section id="abstract"><h2>Abstract</h2><p>We report a brief survey of sediment transport after rain, using field observations from three sites.</p></section><a href="/papers/river.pdf">Full text PDF</a></main></body></html>`;
    const result = await convertPageToEpub(html, 'https://journal.example/papers/river');
    expect(result).toMatchObject({
      source: { scope: 'abstract', pdfUrl: 'https://journal.example/papers/river.pdf' },
      warnings: [{ code: 'partial_content' }],
    });
    expect(vi.mocked(fetch).mock.calls.some((call) => String(call[0]).endsWith('/river.pdf'))).toBe(
      false,
    );
    const full = html.replace(
      '</section><a',
      `</section><section><h2>Methods</h2><p>${'The full experiment is described here. '.repeat(12)}</p></section><a`,
    );
    expect(extractWebArticle(full, 'https://journal.example/papers/river').source.scope).toBe(
      'article',
    );
  });

  test('does not count repository metadata and tabbed site information as full paper prose', () => {
    const abstractText = 'We report observations of river levels at three stations after rain.';
    const html = `<html><head><meta name="citation_title" content="River monitoring">
      <meta name="citation_abstract" content="${abstractText}"><meta name="citation_pdf_url" content="/pdf/river-monitoring">
      <meta name="description" content="Abstract page for repository paper: River monitoring"></head><body><main>
      <h1>River monitoring</h1><blockquote class="abstract"><span>Abstract:</span>${abstractText}</blockquote>
      <div class="metatable"><table summary="Additional metadata"><tr><td>Publication record</td><td>${'The repository lists a submission date, a revision and the manuscript category. '.repeat(5)}</td></tr></table></div>
      <div class="labstabs"><div role="tabpanel"><h2>About this repository</h2><p>${'Our repository shares research tools with the community and welcomes new projects. '.repeat(5)}</p></div></div>
      </main></body></html>`;
    expect(
      extractWebArticle(html, 'https://repository.example/abs/river-monitoring').source,
    ).toMatchObject({
      scope: 'abstract',
      pdfUrl: 'https://repository.example/pdf/river-monitoring',
    });
    const fullHtml = html.replace(
      '</main>',
      `<section role="tabpanel"><h2>Methods</h2><p>${'The full paper describes the sampling protocol and uncertainty at each station. '.repeat(5)}</p></section></main>`,
    );
    expect(
      extractWebArticle(fullHtml, 'https://repository.example/html/river-monitoring').source.scope,
    ).toBe('article');
  });

  test('tries semantic fallback when primary parsers throw or return null', () => {
    vi.spyOn(Defuddle.prototype, 'parse').mockImplementation(() => {
      throw new Error('engine failure');
    });
    const readability = vi.spyOn(Readability.prototype, 'parse').mockReturnValue(null);
    const html =
      '<title>A complete observation</title><article><h1>A complete observation</h1><p>The observation is brief and the experiment is finished.</p></article>';
    expect(extractWebArticle(html, 'https://example.com/observation').source.extractor).toBe(
      'selector:article',
    );
    readability.mockImplementation(() => {
      throw new Error('second engine failure');
    });
    expect(extractWebArticle(html, 'https://example.com/observation').content).toContain(
      'experiment is finished',
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  test('recovers footnotes stored outside the article while retaining fragment links', async () => {
    const html = `<title>Separated notes</title><article><h1>Separated notes</h1><p>${'An observation has an external note. '.repeat(12)}<a href="#fn-1">1</a></p></article><aside><ol><li id="fn-1" role="doc-footnote">The complete original explanatory note.</li></ol></aside>`;
    const result = await convertPageToEpub(html, 'https://example.com/notes');
    const chapter = await epubText(result.file, 'OEBPS/chapter1.xhtml');
    expect(chapter).toContain('id="fn-1"');
    expect(chapter).toContain('The complete original explanatory note.');
    expect(chapter).toContain('href="#fn-1"');
  });

  test('preserves a semantic aside footnote and its id through EPUB sanitization', async () => {
    const html =
      '<title>Footnote observation</title><article><h1>Footnote observation</h1><p>The original observation is complete and includes one measurement condition.<a href="#fn1">1</a></p><aside id="fn1" role="doc-footnote"><p>The sample was measured before sunrise.</p></aside></article>';
    const result = await convertPageToEpub(html, 'https://example.com/aside');
    const chapter = await epubText(result.file, 'OEBPS/chapter1.xhtml');
    expect(chapter).toContain('id="fn1"');
    expect(chapter).toContain('role="doc-footnote"');
  });

  test('accepts a complete short article and preserves source metadata', async () => {
    const html = `<html><head><title>A short observation</title>
      <meta name="citation_author" content="Lin Chen"><meta name="citation_publication_date" content="2026-01-04">
      <link rel="canonical" href="https://journal.example/paper/42"></head><body>
      <article><h1>A short observation</h1><p>A small field experiment found that the seeds opened after rain.</p>
      <p>The result is provisional and the observations will continue next spring.</p></article></body></html>`;
    const result = await convertPageToEpub(html, 'https://journal.example/view/42');
    expect(result.title).toBe('A short observation');
    expect(result.author).toBe('Lin Chen');
    expect(result).toMatchObject({
      source: {
        url: 'https://journal.example/view/42',
        canonicalUrl: 'https://journal.example/paper/42',
        published: '2026-01-04',
        scope: 'article',
      },
    });
    expect(await epubText(result.file, 'content.opf')).toContain(
      '<dc:source>https://journal.example/view/42</dc:source>',
    );
  });

  test('keeps scholarly equations, table structure and linked footnote targets', async () => {
    const html = `<html><head><title>Testing a relation</title></head><body><article>
      <h1>Testing a relation</h1><p>${'We measured a relation between the variables. '.repeat(12)}<a href="#note-1">1</a></p>
      <math xmlns="http://www.w3.org/1998/Math/MathML"><mfrac><mi>a</mi><mi>b</mi></mfrac></math>
      <table><caption>Observed values</caption><thead><tr><th scope="col">Trial</th><th scope="col">Value</th></tr></thead>
      <tbody><tr><td>A</td><td>2</td></tr></tbody></table>
      <div id="note-1" role="doc-footnote"><p>Original note with a stable target.</p></div>
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M0 0L20 20" stroke="black" onclick="evil()"/><foreignObject>Unsafe</foreignObject></svg>
      </article></body></html>`;
    const result = await convertPageToEpub(html, 'https://journal.example/relation');
    const chapter = await epubText(result.file, 'OEBPS/chapter1.xhtml');
    expect(chapter).toContain('<mfrac>');
    expect(chapter).toContain('<caption>Observed values</caption>');
    expect(chapter).toContain('id="note-1"');
    expect(chapter).toContain('href="#note-1"');
    expect(chapter).toContain('<svg');
    expect(chapter).not.toContain('foreignObject');
    expect(chapter).not.toContain('onclick');
    expect(
      new DOMParser()
        .parseFromString(chapter, 'application/xhtml+xml')
        .querySelector('parsererror'),
    ).toBeNull();
  });

  test('reports incomplete image packaging without discarding readable content', async () => {
    const html = `<article><h1>Image report</h1><p>${'The observations are described in the report. '.repeat(12)}</p>
      <img src="./missing.png" alt="Diagram unavailable"></article>`;
    const result = await convertPageToEpub(html, 'https://example.com/reports/one');
    expect(result).toMatchObject({ warnings: [{ code: 'missing_assets', count: 1 }] });
    expect(result.source?.missingAssets).toEqual(['https://example.com/reports/missing.png']);
    expect(await epubText(result.file, 'source.json')).toContain(
      'https://example.com/reports/missing.png',
    );
  });

  test('rejects a long verification page but accepts an article discussing login design', async () => {
    const wall = `<title>Verify you are human</title><h1>Verify you are human</h1><p>${'Please complete the security check to continue. '.repeat(30)}</p>`;
    await expect(convertPageToEpub(wall, 'https://example.com/blocked')).rejects.toMatchObject({
      code: 'login_wall',
    });
    const article = `<title>Login design</title><article><h1>Login design</h1><p>Login forms should clearly describe the required account fields.</p><p>This observation concerns interface design and is the complete article.</p></article>`;
    await expect(convertPageToEpub(article, 'https://example.com/design')).resolves.toMatchObject({
      title: 'Login design',
    });
  });
});
