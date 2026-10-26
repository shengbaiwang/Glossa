import type { ChapterSource } from './types';

export const normalizeSourceText = (text: string): string =>
  text.normalize('NFC').replace(/\s+/g, ' ').trim();

export const normalizeCodeText = (text: string): string =>
  text.normalize('NFC').replace(/\r\n?/g, '\n').trimEnd();

export const checkAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) throw new DOMException('Chapter operation cancelled', 'AbortError');
};

export interface TextBlock {
  text: string;
  kind: ChapterSource['kind'];
  range: Range;
}

const ignoredTags = new Set(['script', 'style', 'noscript', 'template', 'nav', 'head']);
const blockTags = new Set([
  'p',
  'div',
  'section',
  'article',
  'li',
  'dt',
  'dd',
  'pre',
  'blockquote',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
]);

export const isReadable = (node: Text): boolean => {
  if (node.parentElement?.closest('.md-missing-image')) return false;
  const math = node.parentElement?.closest('math');
  // Native MathML contains both visual tokens and the exact TeX annotation.
  // Use the latter once so evidence retains operators and source semantics.
  if (math && !node.parentElement?.closest('annotation[encoding="application/x-tex"]'))
    return false;
  let element = node.parentElement;
  while (element) {
    if (
      ignoredTags.has(element.localName.toLowerCase()) ||
      element.hasAttribute('hidden') ||
      element.getAttribute('aria-hidden') === 'true' ||
      /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\b/i.test(
        element.getAttribute('style') ?? '',
      )
    )
      return false;
    element = element.parentElement;
  }
  return true;
};

/** Exact, readable text inside a range, including partially visible text nodes. */
export function readRangeText(doc: Document, range: Range, code = false): string {
  const walker = doc.createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  const formulas = new Set<Element>();
  const append = (node: Text) => {
    const math = node.parentElement?.closest('math');
    if (math) {
      if (!formulas.has(math) && range.intersectsNode(math)) {
        formulas.add(math);
        parts.push(
          math.querySelector('annotation[encoding="application/x-tex"]')?.textContent ?? '',
        );
      }
      return;
    }
    if (!isReadable(node) || !range.intersectsNode(node)) return;
    const start = node === range.startContainer ? range.startOffset : 0;
    const end = node === range.endContainer ? range.endOffset : node.length;
    parts.push(node.data.slice(start, end));
  };
  if (range.commonAncestorContainer.nodeType === Node.TEXT_NODE)
    append(range.commonAncestorContainer as Text);
  else {
    let node: Node | null;
    while ((node = walker.nextNode())) append(node as Text);
  }
  return (code ? normalizeCodeText : normalizeSourceText)(parts.join(''));
}

/** Intersect with the visible/selected range; never expand to the unread end of a paragraph. */
export function collectRangeBlocks(doc: Document, within: Range): TextBlock[] {
  if (within.collapsed) return [];
  return collectTextBlocks(doc).flatMap((block) => {
    const range = block.range.cloneRange();
    if (
      range.compareBoundaryPoints(Range.END_TO_START, within) >= 0 ||
      range.compareBoundaryPoints(Range.START_TO_END, within) <= 0
    )
      return [];
    if (range.compareBoundaryPoints(Range.START_TO_START, within) < 0)
      range.setStart(within.startContainer, within.startOffset);
    if (range.compareBoundaryPoints(Range.END_TO_END, within) > 0)
      range.setEnd(within.endContainer, within.endOffset);
    const text = readRangeText(doc, range, block.kind === 'code');
    return text ? [{ ...block, range, text }] : [];
  });
}

const owningBlock = (node: Text, root: Element): Element => {
  let element = node.parentElement;
  let closest: Element | undefined;
  while (element && element !== root) {
    const tag = element.localName.toLowerCase();
    if (tag === 'table') return element;
    if (!closest && blockTags.has(tag)) closest = element;
    element = element.parentElement;
  }
  return closest ?? root;
};

const blockKind = (element: Element): ChapterSource['kind'] => {
  const tag = element.localName.toLowerCase();
  if (tag === 'pre' || element.closest('pre')) return 'code';
  if (/^h[1-6]$/.test(tag)) return 'heading';
  if (tag === 'table') return 'table';
  if (tag === 'li' || tag === 'dt' || tag === 'dd') return 'list';
  if (element.closest('blockquote')) return 'quote';
  return 'paragraph';
};

/** Read the original inert DOM without deleting nodes: CFI indices must not shift. */
export const collectTextBlocks = (doc: Document, within?: Range): TextBlock[] => {
  const root = doc.body ?? doc.documentElement;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const groups: { element: Element; nodes: Text[] }[] = [];
  let current: Node | null;
  while ((current = walker.nextNode())) {
    const node = current as Text;
    if (!isReadable(node) || !node.length) continue;
    if (within && (within.comparePoint(node, 0) < 0 || within.comparePoint(node, node.length) > 0))
      continue;
    const element = owningBlock(node, root);
    const previous = groups.at(-1);
    if (previous?.element === element) previous.nodes.push(node);
    else groups.push({ element, nodes: [node] });
  }
  return groups.flatMap(({ element, nodes }) => {
    const kind = blockKind(element);
    const text = (kind === 'code' ? normalizeCodeText : normalizeSourceText)(
      nodes.map((node) => node.data).join(kind === 'table' ? ' ' : ''),
    );
    if (!text) return [];
    const range = doc.createRange();
    range.setStart(nodes[0]!, 0);
    range.setEnd(nodes.at(-1)!, nodes.at(-1)!.length);
    // Whole-formula anchors need a visible box: annotation itself is hidden by
    // MathML layout. Keep the native DOM intact and anchor around its wrapper.
    const firstFormula = nodes[0]!.parentElement?.closest('.glossa-formula');
    const lastFormula = nodes.at(-1)!.parentElement?.closest('.glossa-formula');
    if (firstFormula) range.setStartBefore(firstFormula);
    if (lastFormula) range.setEndAfter(lastFormula);
    return [{ text, kind, range }];
  });
};
