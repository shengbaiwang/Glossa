import type { LocalMap, MapNode } from './workspace';
import { stubTranslation as _ } from '@/utils/misc';

/** Only the current user-visible outline is exported; book text and credentials stay local. */
export function exportMapMarkdown(map: LocalMap): string {
  const markdown = (text: string) =>
    text.replace(/([\\`*_{}\[\]<>#!|])/g, '\\$1').replace(/\r?\n/g, ' ');
  const lines: string[] = [];
  const visit = (node: MapNode, depth: number) => {
    const label = markdown(node.label);
    lines.push(
      depth === 0
        ? `# ${label}\n`
        : `${'  '.repeat(depth - 1)}- ${node.relation ? `${markdown(node.relation)} → ` : ''}${label}`,
    );
    map.nodes
      .filter((child) => child.parentId === node.id)
      .forEach((child) => visit(child, depth + 1));
  };
  visit(map.nodes.find((node) => node.parentId === null)!, 0);
  return `${lines.join('\n')}\n`;
}

/** Standalone vector image, with deterministic wrapping and no foreignObject or active content. */
export function exportMapSvg(map: LocalMap): string {
  const xml = (text: string) =>
    text
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  const wrap = (text: string, width = 15) => {
    const lines = [''];
    let count = 0;
    for (const char of text) {
      // Reserve a full em for wide Latin/CJK glyphs, two for emoji. Only
      // reliably narrow ASCII characters share space; font metrics vary by OS.
      const units = char.codePointAt(0)! > 0xffff ? 2 : /[ilIjtfr1.,;:!'| ]/.test(char) ? 0.5 : 1;
      if (char === '\n' || count + units > width) {
        lines.push('');
        count = 0;
      }
      if (char !== '\n') {
        lines[lines.length - 1] += char;
        count += units;
      }
    }
    return lines;
  };
  const children = (id: string) => map.nodes.filter((n) => n.parentId === id);
  const rows = new Map(
    map.nodes.map((n) => [
      n.id,
      [
        ...(n.relation ? wrap(n.relation).map((line) => ({ line, relation: true })) : []),
        ...wrap(n.label).map((line) => ({ line, relation: false })),
      ],
    ]),
  );
  const heights = new Map<string, number>();
  const measure = (node: MapNode): number => {
    const height = Math.max(
      rows.get(node.id)!.length * 20 + 24,
      children(node.id).reduce((n, child) => n + measure(child) + 16, -16),
    );
    heights.set(node.id, height);
    return height;
  };
  const root = map.nodes.find((n) => n.parentId === null)!;
  const totalHeight = measure(root) + 48;
  const positions = new Map<string, { x: number; y: number; height: number }>();
  let maxDepth = 0;
  const place = (node: MapNode, depth: number, top: number) => {
    maxDepth = Math.max(maxDepth, depth);
    const height = rows.get(node.id)!.length * 20 + 24;
    positions.set(node.id, {
      x: 24 + depth * 280,
      y: top + (heights.get(node.id)! - height) / 2,
      height,
    });
    const kids = children(node.id);
    const combined = kids.reduce((sum, child) => sum + heights.get(child.id)! + 16, -16);
    let nextTop = top + (heights.get(node.id)! - combined) / 2;
    for (const child of kids) {
      place(child, depth + 1, nextTop);
      nextTop += heights.get(child.id)! + 16;
    }
  };
  place(root, 0, 24);
  const links = map.nodes
    .filter((n) => n.parentId)
    .map((n) => {
      const a = positions.get(n.parentId!)!,
        b = positions.get(n.id)!;
      return `<path d="M ${a.x + 240} ${a.y + a.height / 2} C ${a.x + 260} ${a.y + a.height / 2}, ${b.x - 20} ${b.y + b.height / 2}, ${b.x} ${b.y + b.height / 2}" fill="none" stroke="#aaa69e"/>`;
    })
    .join('');
  const nodes = map.nodes
    .map((n) => {
      const p = positions.get(n.id)!;
      return `<g><rect x="${p.x}" y="${p.y}" width="240" height="${p.height}" rx="8" fill="#fffdf7" stroke="#aaa69e"/>${rows
        .get(n.id)!
        .map(
          (row, i) =>
            `<text x="${p.x + 12}" y="${p.y + 26 + i * 20}" font-size="${row.relation ? 11 : 14}" fill="${row.relation ? '#6b675f' : '#26231e'}">${xml(row.line)}</text>`,
        )
        .join('')}</g>`;
    })
    .join('');
  const width = 288 + maxDepth * 280;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${totalHeight}" viewBox="0 0 ${width} ${totalHeight}" role="img" font-family="system-ui, sans-serif"><title>${xml(root.label)}</title><rect width="100%" height="100%" fill="#f5f2ea"/>${links}${nodes}</svg>`;
}

export function mapQuestion(
  map: LocalMap,
  nodeId: string,
  translate: (key: string) => string = _,
): string {
  const path: string[] = [];
  let node = map.nodes.find((n) => n.id === nodeId);
  while (node) {
    path.unshift(node.label);
    node = map.nodes.find((n) => n.id === node!.parentId);
  }
  const title = map.origin?.coverage?.title;
  return `${translate('Explain this mind map idea and its relationship to its parent using the original text. Check whether the wording is supported; treat it as an idea to examine, not an established fact.')}\n${[title, path.join(' → ')].filter(Boolean).join('\n')}`;
}

export interface MapQuestionDraft {
  id: string;
  bookId: string;
  question: string;
}
