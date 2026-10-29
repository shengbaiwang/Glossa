/** Original, fixed documents. Markers annotate content and chrome rather than
 * treating successful parsing or output length as evidence of correctness. */
const prose =
  'The field team observed the water level at three stations after rain. Samples were recorded at the same hour, and the notebook preserves the uncertainty of each measurement. ';
const text = `<p>Observation marker. ${prose.repeat(4)}</p><p>Conclusion marker. ${prose.repeat(3)}</p>`;
const frame = (body: string) =>
  `<html><head><title>Field observations</title><meta name="author" content="A. Researcher"></head><body><nav><a href="/menu">Navigation marker</a></nav>${body}<footer>Footer marker</footer></body></html>`;

export const webArticleCorpus = [
  {
    name: 'semantic article',
    html: frame(`<article><h1>Field observations</h1>${text}</article>`),
    required: ['Observation marker', 'Conclusion marker'],
  },
  {
    name: 'main container',
    html: frame(`<main><h1>Field observations</h1>${text}</main>`),
    required: ['Observation marker', 'Conclusion marker'],
  },
  {
    name: 'article role',
    html: frame(`<div role="article"><h1>Field observations</h1>${text}</div>`),
    required: ['Observation marker', 'Conclusion marker'],
  },
  {
    name: 'schema article body',
    html: frame(`<div itemprop="articleBody"><h1>Field observations</h1>${text}</div>`),
    required: ['Observation marker', 'Conclusion marker'],
  },
  {
    name: 'blog entry content',
    html: frame(`<div class="entry-content"><h1>Field observations</h1>${text}</div>`),
    required: ['Observation marker', 'Conclusion marker'],
  },
  {
    name: 'markdown document',
    html: frame(
      `<main class="markdown-body"><h1>Field observations</h1>${text}<pre><code>sample_count = 3</code></pre></main>`,
    ),
    required: ['Observation marker', 'Conclusion marker', 'sample_count = 3'],
  },
  {
    name: 'Chinese article',
    html: frame(
      `<article><h1>雨后观察记录</h1><p>${'研究小组在三个站点记录了雨后的水位变化，并保留每一次测量的不确定性。'.repeat(10)}</p><p>结论标记：本次观察仅适用于调查区域，不能推广到整个流域。</p></article>`,
    ),
    required: ['雨后的水位变化', '结论标记'],
  },
  {
    name: 'complete short article',
    html: frame(
      '<article><h1>A small observation</h1><p>The seeds opened after rain. This is the complete observation.</p></article>',
    ),
    required: ['The seeds opened after rain'],
  },
  {
    name: 'table report',
    html: frame(
      `<article><h1>Field observations</h1>${text}<table><caption>Table marker</caption><tbody><tr><th>Station</th><th>Level</th></tr><tr><td>North</td><td>42</td></tr></tbody></table></article>`,
    ),
    required: ['Observation marker', 'Table marker', 'North'],
  },
  {
    name: 'scholarly note',
    html: frame(
      `<article><h1>Field observations</h1>${text}<p><a href="#fn-1">1</a></p><section class="footnotes"><ol><li id="fn-1">Footnote marker: raw measurements remain provisional.</li></ol></section></article>`,
    ),
    required: ['Observation marker', 'Footnote marker'],
  },
  {
    name: 'publisher abstract',
    html: frame(
      `<main><h1>Field observations</h1><section id="abstract"><h2>Abstract</h2>${text}</section></main>`,
    ),
    required: ['Observation marker', 'Conclusion marker'],
  },
  {
    name: 'old table layout',
    html: frame(
      `<table><tbody><tr><td><h1>Field observations</h1>${text}</td></tr></tbody></table>`,
    ),
    required: ['Observation marker', 'Conclusion marker'],
  },
];
