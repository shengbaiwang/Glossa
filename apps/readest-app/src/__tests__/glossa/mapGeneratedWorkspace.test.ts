import { describe, expect, it } from 'vitest';
import { getPassageId } from '@/glossa/passages/passages';
import type { ReadingMindmap } from '@/glossa/mindmap/types';
import {
  createMapFromMindmap,
  editTree,
  getMapNodeSources,
  mapWorkspaceSchema,
} from '@/glossa/mindmap/workspace';

function fixture(): ReadingMindmap {
  const text = '例子的解释范围受到它的适用条件限制。';
  const sources: ReadingMindmap['sources'] = [
    {
      sourceId: 's1',
      text,
      kind: 'paragraph',
      anchor: {
        sectionIndex: 0,
        cfi: 'epubcfi(/6/2!/4/2)',
        quote: { exact: text, prefix: '', suffix: '' },
      },
    },
  ];
  return {
    id: 'generated',
    bookId: 'book',
    chapterId: 'chapter',
    passageId: getPassageId('chapter', sources),
    createdAt: '2026-09-13T00:00:00.000Z',
    cacheKey: 'a'.repeat(64),
    contentHash: 'b'.repeat(64),
    promptVersion: 'mindmap-1',
    schemaVersion: 1,
    provider: { id: 'test', name: 'Test', baseUrl: 'https://example.test/v1', model: 'test' },
    sources,
    insufficientEvidence: false,
    nodes: [
      {
        id: 'root',
        parentId: null,
        label: '例子的解释范围',
        relation: '',
        explanation: text,
        sourceIds: ['s1'],
        kind: 'source',
      },
      {
        id: 'condition',
        parentId: 'root',
        label: '适用条件',
        relation: '受到限制',
        explanation: text,
        sourceIds: ['s1'],
        kind: 'inference',
      },
    ],
  };
}

describe('editable generated maps', () => {
  it('keeps independent original evidence while labels and relationships are edited', () => {
    const generated = fixture();
    const map = createMapFromMindmap(generated);
    expect(map.id).not.toBe(generated.id);
    expect(map.view).toBe('outline');
    expect(map.nodes[1]?.originNodeId).toBe('condition');
    map.nodes = editTree(map.nodes, {
      type: 'text',
      id: 'condition',
      label: '我的补充理解',
      relation: '可能相关',
    });
    expect(map.nodes[1]?.label).toBe('我的补充理解');
    expect(map.origin?.nodes[1]).toEqual(generated.nodes[1]);
    expect(map.origin?.nodes[1]?.kind).toBe('inference');
    expect(getMapNodeSources(map, 'condition')).toEqual(generated.sources);
    generated.sources[0]!.text = 'changed after conversion';
    expect(getMapNodeSources(map, 'condition')[0]?.text).not.toBe('changed after conversion');
  });

  it('leaves newly added and deleted ideas without original source associations', () => {
    const map = createMapFromMindmap(fixture());
    map.nodes = editTree(map.nodes, { type: 'delete', id: 'condition' });
    expect(getMapNodeSources(map, 'condition')).toEqual([]);
    map.nodes = editTree(map.nodes, {
      type: 'add',
      id: 'condition',
      parentId: 'root',
      label: 'A new manual idea',
    });
    expect(getMapNodeSources(map, 'condition')).toEqual([]);
  });

  it('preserves old manual workspaces and validates generated source identity', () => {
    const map = createMapFromMindmap(fixture());
    const workspace = { version: 1, bookId: 'book', revision: 0, activeId: map.id, maps: [map] };
    expect(mapWorkspaceSchema.parse(JSON.parse(JSON.stringify(workspace)))).toEqual(workspace);
    expect(mapWorkspaceSchema.safeParse({ ...workspace, bookId: 'other-book' }).success).toBe(
      false,
    );
    map.origin!.nodes[1]!.sourceIds = ['invented'];
    expect(mapWorkspaceSchema.safeParse(workspace).success).toBe(false);
  });

  it('rejects unavailable provenance and explicit evidence insufficiency', () => {
    const generated = fixture();
    generated.nodes[1]!.sourceIds = ['missing'];
    expect(() => createMapFromMindmap(generated)).toThrow();
    expect(() =>
      createMapFromMindmap({ ...fixture(), nodes: [], insufficientEvidence: true }),
    ).toThrow();
    const map = createMapFromMindmap(fixture());
    map.nodes[1]!.originNodeId = 'missing';
    const workspace = { version: 1, bookId: 'book', revision: 0, activeId: map.id, maps: [map] };
    expect(mapWorkspaceSchema.safeParse(workspace).success).toBe(false);
  });
});
