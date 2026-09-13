import { z } from 'zod';

const id = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9_-]+$/);
const nodeSchema = z
  .object({
    id,
    parentId: id.nullable(),
    label: z.string().max(500),
    relation: z.string().max(80),
  })
  .strict();
export type MapNode = z.infer<typeof nodeSchema>;

export const treeSchema = z
  .array(nodeSchema)
  .min(1)
  .max(200)
  .superRefine((nodes, ctx) => {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    if (byId.size !== nodes.length || nodes.filter((n) => n.parentId === null).length !== 1) {
      ctx.addIssue({ code: 'custom', message: 'Invalid tree root or duplicate ID' });
      return;
    }
    for (const node of nodes) {
      let current: MapNode | undefined = node;
      const seen = new Set<string>();
      while (current) {
        if (seen.has(current.id) || seen.size >= 12) {
          ctx.addIssue({ code: 'custom', message: 'Cycle or excessive depth' });
          break;
        }
        seen.add(current.id);
        if (current.parentId === null) break;
        current = byId.get(current.parentId);
        if (!current) ctx.addIssue({ code: 'custom', message: 'Missing parent' });
      }
    }
  });

const mapSchema = z
  .object({
    id,
    nodes: treeSchema,
    view: z.enum(['outline', 'map']),
    collapsed: z.array(id).max(200),
    focusId: id.nullable(),
    selectedId: id,
    zoom: z.number().min(0.4).max(1.6),
  })
  .strict()
  .superRefine((map, ctx) => {
    const ids = new Set(map.nodes.map((n) => n.id));
    if (
      !ids.has(map.selectedId) ||
      (map.focusId && !ids.has(map.focusId)) ||
      map.collapsed.some((n) => !ids.has(n))
    )
      ctx.addIssue({ code: 'custom', message: 'Invalid view state' });
  });
export type LocalMap = z.infer<typeof mapSchema>;
export const mapWorkspaceSchema = z
  .object({
    version: z.literal(1),
    bookId: z.string().min(1).max(500),
    revision: z.number().int().nonnegative(),
    activeId: id.nullable(),
    maps: z.array(mapSchema).max(20),
  })
  .strict()
  .superRefine((workspace, ctx) => {
    if (
      new Set(workspace.maps.map((m) => m.id)).size !== workspace.maps.length ||
      (workspace.activeId === null
        ? workspace.maps.length > 0
        : !workspace.maps.some((m) => m.id === workspace.activeId))
    )
      ctx.addIssue({ code: 'custom', message: 'Invalid active map' });
  });
export type MapWorkspace = z.infer<typeof mapWorkspaceSchema>;

export function createMap(label: string): LocalMap {
  const rootId = crypto.randomUUID();
  return {
    id: crypto.randomUUID(),
    nodes: [{ id: rootId, parentId: null, label: label.slice(0, 500), relation: '' }],
    view: 'outline',
    collapsed: [],
    focusId: null,
    selectedId: rootId,
    zoom: 1,
  };
}

export type TreeEdit =
  | { type: 'add'; id: string; parentId: string; label: string; afterId?: string }
  | { type: 'text'; id: string; label: string; relation: string }
  | { type: 'delete' | 'indent' | 'outdent' | 'up' | 'down'; id: string };

export function descendants(nodes: MapNode[], id: string): Set<string> {
  const result = new Set([id]);
  for (let size = 0; size !== result.size; ) {
    size = result.size;
    for (const node of nodes) if (node.parentId && result.has(node.parentId)) result.add(node.id);
  }
  return result;
}

/** Array order defines sibling order; parent IDs define ownership of whole branches. */
export function editTree(nodes: MapNode[], edit: TreeEdit): MapNode[] {
  let next = nodes.map((n) => ({ ...n }));
  const node = next.find((n) => n.id === edit.id);
  if (edit.type === 'add') {
    if (!next.some((n) => n.id === edit.parentId)) return nodes;
    const insertion = edit.afterId ? next.findIndex((n) => n.id === edit.afterId) + 1 : next.length;
    next.splice(insertion, 0, {
      id: edit.id,
      parentId: edit.parentId,
      label: edit.label,
      relation: '',
    });
  } else {
    if (!node) return nodes;
    if (edit.type === 'text') {
      node.label = edit.label;
      node.relation = node.parentId ? edit.relation : '';
    } else {
      if (!node.parentId) return nodes;
      const siblings = next.filter((n) => n.parentId === node.parentId);
      const index = siblings.findIndex((n) => n.id === node.id);
      if (edit.type === 'delete') {
        const removed = descendants(nodes, node.id);
        next = next.filter((n) => !removed.has(n.id));
      } else if (edit.type === 'indent') {
        if (!siblings[index - 1]) return nodes;
        node.parentId = siblings[index - 1]!.id;
      } else if (edit.type === 'outdent') {
        const parent = next.find((n) => n.id === node.parentId)!;
        if (!parent.parentId) return nodes;
        node.parentId = parent.parentId;
        next = next.filter((n) => n.id !== node.id);
        next.splice(next.indexOf(parent) + 1, 0, node);
      } else {
        const other = siblings[index + (edit.type === 'up' ? -1 : 1)];
        if (!other) return nodes;
        const a = next.indexOf(node);
        const b = next.indexOf(other);
        next[a] = other;
        next[b] = node;
      }
    }
  }
  return treeSchema.safeParse(next).success ? next : nodes;
}

export function cleanMap(map: LocalMap): LocalMap {
  const ids = new Set(map.nodes.map((n) => n.id));
  const root = map.nodes.find((n) => n.parentId === null)!;
  let selectedId = ids.has(map.selectedId) ? map.selectedId : root.id;
  let focusId = map.focusId && ids.has(map.focusId) ? map.focusId : null;
  if (focusId && !descendants(map.nodes, focusId).has(selectedId)) focusId = null;
  let current = map.nodes.find((n) => n.id === selectedId);
  while (current?.parentId && current.id !== focusId) {
    current = map.nodes.find((n) => n.id === current?.parentId);
    if (current && map.collapsed.includes(current.id)) selectedId = current.id;
  }
  return {
    ...map,
    selectedId,
    focusId,
    collapsed: map.collapsed.filter((n) => ids.has(n)),
  };
}
