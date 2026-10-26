import type { MarkedExtension } from 'marked';
import katex from 'katex';
import DOMPurify from 'dompurify';

interface MathToken {
  type: string;
  raw: string;
  text: string;
  display: boolean;
}
const escapeMathText = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Emit inert placeholders first. Untrusted raw HTML still passes through the
// ordinary sanitizer; only our bounded, non-trusting KaTeX output is added later.
const renderer = (token: MathToken) =>
  `<span class="glossa-formula">${escapeMathText(token.raw.trim())}</span>`;
export const markdownMath: MarkedExtension = {
  extensions: [
    {
      name: 'glossaBlockMath',
      level: 'block',
      start: (src) => src.indexOf('$$'),
      tokenizer(src) {
        const match = /^\$\$\s*\n([\s\S]+?)\n\$\$[ \t]*(?:\n|$)/.exec(src);
        if (match)
          return { type: 'glossaBlockMath', raw: match[0], text: match[1]!, display: true };
        return undefined;
      },
      renderer: (token) => `<div>${renderer(token as MathToken)}</div>\n`,
    },
    {
      name: 'glossaInlineMath',
      level: 'inline',
      start: (src) => src.indexOf('$'),
      tokenizer(src) {
        const match = /^(\${1,2})(?!\$)((?:\\.|[^\\\n$])+?)\1(?!\d)/.exec(src);
        if (!match || match[2]!.trim() !== match[2] || /^\d[\d,.]*$/.test(match[2]!)) return;
        return {
          type: 'glossaInlineMath',
          raw: match[0],
          text: match[2]!,
          display: match[1] === '$$',
        };
      },
      renderer: (token) => renderer(token as MathToken),
    },
  ],
};

export function renderMarkdownMath(root: HTMLElement): void {
  for (const node of root.querySelectorAll<HTMLElement>('.glossa-formula')) {
    const original = node.textContent ?? '';
    const delimiter = original.startsWith('$$') ? '$$' : '$';
    if (!original.startsWith(delimiter) || !original.endsWith(delimiter)) continue;
    const expression = original.slice(delimiter.length, -delimiter.length).trim();
    // Retain the original expression on errors; a malformed formula never
    // prevents reading the rest of the document or triggers external requests.
    if (!expression || expression.length > 8192) continue;
    try {
      node.innerHTML = DOMPurify.sanitize(
        katex.renderToString(expression, {
          output: 'mathml',
          displayMode: delimiter === '$$',
          trust: false,
          throwOnError: false,
          maxExpand: 100,
          maxSize: 10,
        }),
        {
          USE_PROFILES: { html: true, mathMl: true },
          ADD_TAGS: ['semantics', 'annotation'],
          ADD_ATTR: ['encoding', 'display'],
          FORBID_TAGS: ['a', 'img', 'style', 'script', 'iframe'],
          FORBID_ATTR: ['style'],
        },
      );
    } catch {
      node.textContent = original;
    }
  }
}
