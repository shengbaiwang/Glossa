import { z } from 'zod';
import type { ChapterSource } from '@/glossa/context/types';
import { passageSourcesSchema } from '@/glossa/passages/schema';
import { getPassageId } from '@/glossa/passages/passages';
import { PassageError } from '@/glossa/passages/types';
import { stubTranslation as _ } from '@/utils/misc';

const nodeSchema = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/),
    parentId: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{1,40}$/)
      .nullable(),
    label: z.string().trim().min(1).max(60),
    relation: z.string().trim().max(24),
    explanation: z.string().trim().min(1).max(300),
    sourceIds: z
      .array(z.string().min(1).max(200))
      .min(1)
      .max(4)
      .refine((ids) => new Set(ids).size === ids.length),
    kind: z.enum(['source', 'inference']),
  })
  .strict();

export const mindmapBodySchema = z
  .object({
    nodes: z.array(nodeSchema).max(24),
    insufficientEvidence: z.boolean(),
  })
  .strict()
  .refine(({ nodes, insufficientEvidence }) => {
    if (insufficientEvidence) return nodes.length === 0;
    if (!nodes.length || nodes.filter((n) => n.parentId === null).length !== 1) return false;
    const byId = new Map(nodes.map((n) => [n.id, n]));
    if (byId.size !== nodes.length) return false;
    return nodes.every((node) => {
      if (node.parentId === null ? node.relation !== '' : !node.relation) return false;
      const visited = new Set([node.id]);
      let parentId = node.parentId;
      while (parentId !== null) {
        const parent = byId.get(parentId);
        if (!parent || visited.has(parentId)) return false;
        visited.add(parentId);
        if (visited.size > 4) return false;
        parentId = parent.parentId;
      }
      return true;
    });
  });
export type MindmapNode = z.infer<typeof nodeSchema>;
export type MindmapBody = z.infer<typeof mindmapBodySchema>;

export const mapCoverageSchema = z
  .object({
    kind: z.enum(['chapter', 'book', 'branch']),
    title: z.string().min(1).max(500),
    sourceCount: z.number().int().min(1).max(4800),
    characterCount: z.number().int().min(1).max(240000),
    batches: z.number().int().min(1).max(24),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type MapCoverage = z.infer<typeof mapCoverageSchema>;
export const overviewSourcesSchema = z
  .array(passageSourcesSchema.element)
  .min(1)
  .max(4800)
  .refine(
    (sources) =>
      new Set(sources.map((s) => s.sourceId)).size === sources.length &&
      sources.every((s) => s.text === s.anchor.quote.exact) &&
      sources.reduce((total, s) => total + s.text.length, 0) <= 240000,
  );

export function validateMindmapSources(body: MindmapBody, sources: ChapterSource[]): boolean {
  const ids = new Set(sources.map((s) => s.sourceId));
  return (
    ids.size === sources.length && body.nodes.every((n) => n.sourceIds.every((id) => ids.has(id)))
  );
}

/** Shared persistence protocol for the original generation and editable copies. */
export const readingMindmapSchema = mindmapBodySchema
  .safeExtend({
    id: z.string().min(1).max(200),
    bookId: z.string().min(1).max(500),
    chapterId: z.string().min(1).max(500),
    passageId: z.string().min(1).max(600),
    createdAt: z.iso.datetime(),
    cacheKey: z.string().regex(/^[a-f0-9]{64}$/),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    promptVersion: z.enum([
      'mindmap-1',
      'mindmap-2',
      'mindmap-overview-1',
      'mindmap-overview-2',
      'mindmap-branch-1',
    ]),
    schemaVersion: z.literal(1),
    provider: z
      .object({ id: z.string(), name: z.string(), baseUrl: z.string(), model: z.string() })
      .strict(),
    sources: overviewSourcesSchema,
    coverage: mapCoverageSchema.optional(),
  })
  .strict()
  .refine(
    (map) =>
      validateMindmapSources(map, map.sources) &&
      map.passageId === getPassageId(map.chapterId, map.sources) &&
      (map.promptVersion === 'mindmap-overview-1' ||
      map.promptVersion === 'mindmap-overview-2' ||
      map.promptVersion === 'mindmap-branch-1'
        ? !!map.coverage &&
          map.coverage.sourceCount >= map.sources.length &&
          map.coverage.characterCount >= map.sources.reduce((sum, s) => sum + s.text.length, 0) &&
          (map.promptVersion === 'mindmap-branch-1'
            ? map.coverage.kind === 'branch'
            : map.coverage.kind !== 'branch')
        : !map.coverage && passageSourcesSchema.safeParse(map.sources).success),
  );

export function parseMindmap(raw: string, sources: ChapterSource[]): MindmapBody {
  try {
    if (raw.length > 32000) throw new Error();
    const json = raw.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i, '$1');
    const result = mindmapBodySchema.parse(JSON.parse(json));
    if (
      !passageSourcesSchema.safeParse(sources).success ||
      !validateMindmapSources(result, sources)
    )
      throw new Error();
    return result;
  } catch {
    throw new PassageError(
      'invalid-response',
      _('The mind map was incomplete or cited unavailable sources. Try again.'),
    );
  }
}
