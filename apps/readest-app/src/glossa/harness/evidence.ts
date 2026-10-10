import { z } from 'zod';

export const argumentPointsSchema = z
  .array(
    z
      .object({
        text: z.string().trim().min(1).max(1000),
        sourceIds: z.array(z.string().min(1).max(200)).min(1).max(4),
      })
      .strict(),
  )
  .max(80);
export const argumentInventorySchema = z
  .object({
    coveredSourceIds: z.array(z.string().min(1).max(200)).min(1).max(200),
    points: argumentPointsSchema,
  })
  .strict();
export class EvidenceError extends Error {
  constructor(public readonly code: 'format' | 'structure' | 'coverage' | 'sources') {
    super(`Invalid evidence contract: ${code}`);
  }
}
export function readInventory(raw: string, sources: { sourceId: string }[]) {
  let value: unknown;
  if (raw.length > 120000) throw new EvidenceError('format');
  try {
    value = JSON.parse(raw.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i, '$1'));
  } catch {
    throw new EvidenceError('format');
  }
  const parsed = argumentInventorySchema.safeParse(value);
  if (!parsed.success) throw new EvidenceError('structure');
  const allowed = new Set(sources.map((source) => source.sourceId));
  const { coveredSourceIds, points } = parsed.data;
  if (
    coveredSourceIds.length !== allowed.size ||
    new Set(coveredSourceIds).size !== allowed.size ||
    coveredSourceIds.some((id) => !allowed.has(id))
  )
    throw new EvidenceError('coverage');
  if (points.some((point) => point.sourceIds.some((id) => !allowed.has(id))))
    throw new EvidenceError('sources');
  return parsed.data;
}
export function inventoryPrompt() {
  return `Return JSON only with this exact schema: ${JSON.stringify(z.toJSONSchema(argumentInventorySchema))}. coveredSourceIds lists every supplied ID exactly once. Each point preserves its conditions, negation, temporal scope and uncertainty in text itself. Use only supplied source IDs. This receipt proves input coverage, not semantic correctness.`;
}
