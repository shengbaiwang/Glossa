import DOMPurify from 'dompurify';
import { Marked } from 'marked';
import markedKatex from 'marked-katex-extension';

// Model output is untrusted: render Markdown with math, then strip anything
// executable or remote-loading. KaTeX emits MathML, so `semantics`/`annotation`
// must survive the sanitizer even though they are not in its default allowlist.
const markdown = new Marked({ gfm: true, breaks: true }).use(
  markedKatex({ throwOnError: false, output: 'mathml', nonStandard: true }),
  {
    renderer: {
      html: ({ text }) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    },
  },
);

export function renderAnswerHtml(text: string): string {
  const html = markdown.parse(text) as string;
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, mathMl: true },
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'img'],
    FORBID_ATTR: ['style'],
    ADD_TAGS: ['semantics', 'annotation'],
    ADD_ATTR: ['encoding', 'display'],
    ALLOW_DATA_ATTR: false,
  }).trim();
}
