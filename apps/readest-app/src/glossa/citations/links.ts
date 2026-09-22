/** Accept either citation spelling, but only for an exact supplied source ID. */
export function citationSourceId(href: string, allowed: ReadonlySet<string>): string | null {
  if (!href.startsWith('#')) return null;
  const fragment = href.slice(1);
  const canonical = fragment.startsWith('source-') ? fragment.slice('source-'.length) : '';
  if (canonical && allowed.has(canonical)) return canonical;
  return allowed.has(fragment) ? fragment : null;
}

/** Read Markdown links, including references, without treating examples/code as evidence. */
export function citedSourceIds(text: string, allowed: ReadonlySet<string>): Set<string> {
  const cited = new Set<string>();
  markdown.walkTokens(markdown.lexer(text), (token) => {
    if (token.type !== 'link') return;
    const id = citationSourceId(token.href, allowed);
    if (id) cited.add(id);
  });
  return cited;
}
import { Marked } from 'marked';

const markdown = new Marked({ gfm: true });
