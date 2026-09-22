import { z } from 'zod';
import type { ChapterSource } from '@/glossa/context/types';
import { inventoryPointsSchema } from './checkpoints';
import { MapOutputError, mapSchemaError } from './diagnostics';
import { mindmapBodySchema, validateMindmapSources, type MindmapBody } from './schema';

type Sources = Pick<ChapterSource, 'sourceId'>[];
const coverage = z.array(z.string().min(1).max(200)).min(1);
const directSchema = z
  .object({ coveredSourceIds: coverage.max(100), map: mindmapBodySchema })
  .strict();
const inventorySchema = z
  .object({ coveredSourceIds: coverage.max(200), points: inventoryPointsSchema })
  .strict();

function parse<T>(raw: string, schema: z.ZodType<T>): T {
  let value: unknown;
  if (raw.length > 100000)
    throw new MapOutputError({ kind: 'format', issues: [{ path: ['response'], rule: 'too_big' }] });
  try {
    value = JSON.parse(raw.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i, '$1'));
  } catch {
    throw new MapOutputError({
      kind: 'format',
      issues: [{ path: ['response'], rule: 'invalid_json' }],
    });
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw mapSchemaError(parsed.error);
  return parsed.data;
}
function checkCoverage(ids: string[], sources: Sources): void {
  const supplied = new Set(sources.map((source) => source.sourceId));
  if (
    ids.length !== sources.length ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !supplied.has(id))
  )
    throw new MapOutputError({
      kind: 'coverage',
      issues: [{ path: ['coveredSourceIds'], rule: 'complete_coverage' }],
    });
}
function checkSources(body: MindmapBody, sources: Sources): MindmapBody {
  if (!validateMindmapSources(body, sources))
    throw new MapOutputError({
      kind: 'sources',
      issues: [{ path: ['nodes', 'sourceIds'], rule: 'source_whitelist' }],
    });
  return body;
}
export function readMapOutput(raw: string, sources: Sources): MindmapBody {
  return checkSources(parse(raw, mindmapBodySchema), sources);
}
export function readDirectMap(raw: string, sources: Sources): MindmapBody {
  const parsed = parse(raw, directSchema);
  checkCoverage(parsed.coveredSourceIds, sources);
  return checkSources(parsed.map, sources);
}
export function readMapInventory(
  raw: string,
  sources: Sources,
): z.infer<typeof inventoryPointsSchema> {
  const parsed = parse(raw, inventorySchema);
  checkCoverage(parsed.coveredSourceIds, sources);
  const supplied = new Set(sources.map((source) => source.sourceId));
  if (parsed.points.some((point) => point.sourceIds.some((id) => !supplied.has(id))))
    throw new MapOutputError({
      kind: 'sources',
      issues: [{ path: ['points', 'sourceIds'], rule: 'source_whitelist' }],
    });
  return parsed.points;
}

const mapExample = {
  nodes: [
    {
      id: 'root',
      parentId: null,
      label: 'central topic',
      relation: '',
      explanation: 'sourced explanation',
      sourceIds: ['m1'],
      kind: 'source',
    },
    {
      id: 'n1',
      parentId: 'root',
      label: 'limiting condition',
      relation: 'requires',
      explanation: 'why this condition limits the parent claim',
      sourceIds: ['m2'],
      kind: 'source',
    },
  ],
  insufficientEvidence: false,
};
/** A single complete shape per stage, derived from the same schema used to accept outputs. */
export function mapOutputPrompt(stage: 'direct' | 'inventory' | 'map'): string {
  const schema =
    stage === 'direct' ? directSchema : stage === 'inventory' ? inventorySchema : mindmapBodySchema;
  const example =
    stage === 'direct'
      ? { coveredSourceIds: ['m1', 'm2'], map: mapExample }
      : stage === 'inventory'
        ? {
            coveredSourceIds: ['m1', 'm2'],
            points: [
              { text: 'a claim together with its limiting condition', sourceIds: ['m1', 'm2'] },
            ],
          }
        : mapExample;
  return `Return JSON only, without fences, explanations outside JSON or extra fields. Exact response schema: ${JSON.stringify(z.toJSONSchema(schema))}\nShape example (replace example IDs and text with actual evidence): ${JSON.stringify(example)}. ${stage !== 'map' ? 'coveredSourceIds must list EVERY supplied source ID exactly once, including headings and non-content; this is a reading receipt, not a substitute for preserving distinct ideas.' : ''}`;
}
