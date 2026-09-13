import { describe, expect, it } from 'vitest';
import { cleanMap, createMap, editTree, mapWorkspaceSchema } from '@/glossa/mindmap/workspace';

describe('local mind map structure', () => {
  it('moves entire branches, preserving order and preventing cycles', () => {
    const map = createMap('A');
    let nodes = editTree(map.nodes, {
      type: 'add',
      id: 'a',
      parentId: map.nodes[0]!.id,
      label: 'A',
    });
    nodes = editTree(nodes, { type: 'add', id: 'b', parentId: map.nodes[0]!.id, label: 'B' });
    nodes = editTree(nodes, { type: 'add', id: 'c', parentId: 'a', label: 'C' });
    nodes = editTree(nodes, { type: 'indent', id: 'b' });
    expect(nodes.find((n) => n.id === 'b')?.parentId).toBe('a');
    nodes = editTree(nodes, { type: 'outdent', id: 'c' });
    expect(nodes.filter((n) => n.parentId === map.nodes[0]!.id).map((n) => n.label)).toEqual([
      'A',
      'C',
    ]);
    expect(editTree(nodes, { type: 'delete', id: map.nodes[0]!.id })).toEqual(nodes);
    expect(editTree(nodes, { type: 'delete', id: 'a' }).some((n) => n.id === 'b')).toBe(false);
  });
  it('rejects corrupt structures, duplicates and unknown fields before persistence', () => {
    const map = createMap('Root');
    const workspace = { version: 1, bookId: 'book', revision: 0, activeId: map.id, maps: [map] };
    expect(mapWorkspaceSchema.safeParse(workspace).success).toBe(true);
    expect(mapWorkspaceSchema.safeParse({ ...workspace, activeId: 'missing' }).success).toBe(false);
    map.nodes.push({ id: 'loop', parentId: 'loop', label: 'Loop', relation: '' });
    expect(mapWorkspaceSchema.safeParse(workspace).success).toBe(false);
  });
  it('reorders siblings without reparenting descendants', () => {
    const map = createMap('Root');
    const root = map.nodes[0]!.id;
    let nodes = editTree(map.nodes, { type: 'add', id: 'a', parentId: root, label: 'First' });
    nodes = editTree(nodes, { type: 'add', id: 'b', parentId: root, label: 'Second' });
    nodes = editTree(nodes, { type: 'up', id: 'b' });
    expect(nodes.filter((n) => n.parentId === root).map((n) => n.id)).toEqual(['b', 'a']);
    expect(editTree(nodes, { type: 'indent', id: 'b' })).toEqual(nodes);
  });
});

it('enforces depth and size limits without damaging a valid tree', () => {
  const map = createMap('Root');
  let nodes = map.nodes;
  let parentId = nodes[0]!.id;
  for (let i = 1; i < 12; i++) {
    nodes = editTree(nodes, { type: 'add', id: `depth-${i}`, parentId, label: 'Idea' });
    parentId = `depth-${i}`;
  }
  expect(nodes).toHaveLength(12);
  expect(editTree(nodes, { type: 'add', id: 'too-deep', parentId, label: 'Extra' })).toBe(nodes);
  while (nodes.length < 200)
    nodes = editTree(nodes, {
      type: 'add',
      id: `leaf-${nodes.length}`,
      parentId: nodes[0]!.id,
      label: 'Leaf',
    });
  expect(
    editTree(nodes, { type: 'add', id: 'too-many', parentId: nodes[0]!.id, label: 'Extra' }),
  ).toBe(nodes);
});

it('keeps the active idea visible after collapsing or moving outside a focused branch', () => {
  const map = createMap('Root');
  const root = map.nodes[0]!.id;
  map.nodes = editTree(map.nodes, { type: 'add', id: 'a', parentId: root, label: 'A' });
  map.nodes = editTree(map.nodes, { type: 'add', id: 'child', parentId: 'a', label: 'Child' });
  map.nodes = editTree(map.nodes, { type: 'add', id: 'b', parentId: root, label: 'B' });
  expect(cleanMap({ ...map, collapsed: ['a'], selectedId: 'child' }).selectedId).toBe('a');
  expect(cleanMap({ ...map, focusId: 'a', selectedId: 'b' }).focusId).toBeNull();
  expect(
    cleanMap({ ...map, focusId: 'a', collapsed: [root], selectedId: 'child' }).selectedId,
  ).toBe('child');
});
