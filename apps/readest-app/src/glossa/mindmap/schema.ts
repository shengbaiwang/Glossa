import { z } from 'zod';
import type { ChapterSource } from '@/glossa/context/types';
import { passageSourcesSchema } from '@/glossa/guide/schema';
import { GuideError } from '@/glossa/guide/types';
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

export function validateMindmapSources(body: MindmapBody, sources: ChapterSource[]): boolean {
  const ids = new Set(sources.map((s) => s.sourceId));
  return (
    ids.size === sources.length && body.nodes.every((n) => n.sourceIds.every((id) => ids.has(id)))
  );
}

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
    throw new GuideError(
      'invalid-response',
      _('The mind map was incomplete or cited unavailable sources. Try again.'),
    );
  }
}
