/** Accept either citation spelling, but only for an exact supplied source ID. */
export function citationSourceId(href: string, allowed: ReadonlySet<string>): string | null {
  if (!href.startsWith('#')) return null;
  const fragment = href.slice(1);
  const canonical = fragment.startsWith('source-') ? fragment.slice('source-'.length) : '';
  if (canonical && allowed.has(canonical)) return canonical;
  return allowed.has(fragment) ? fragment : null;
}
