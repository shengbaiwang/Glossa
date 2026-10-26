import { z } from 'zod';
import { validateProviderConfig, type ProviderConfig } from '@/glossa/ai/provider';
import type { ChapterSource } from '@/glossa/context/types';
import { sourceWire, type BookReadingAccess } from '@/glossa/harness/book';
import { createDerivedStore, type DerivedStore } from '@/glossa/harness/derivedStore';
import { inventoryPointsSchema } from './checkpoints';
import { hashMindmapData } from './identity';

export type InventoryPoints = z.infer<typeof inventoryPointsSchema>;
export type MapInventoryStore = DerivedStore<InventoryPoints>;

/** The exact extraction input, including context and anchors, must agree across targets. */
export async function getMapInventoryKey(
  access: BookReadingAccess,
  sources: ChapterSource[],
  input: ProviderConfig,
): Promise<string> {
  const config = validateProviderConfig(input);
  return hashMindmapData({
    version: 'map-inventory-4',
    documentHash: access.documentHash,
    provider: [
      config.id,
      config.baseUrl,
      config.model,
      config.reasoningEffort ?? null,
      config.maxTokens ?? null,
    ],
    sources: sources.map((source) => ({
      ...sourceWire(source, access),
      anchor: source.anchor,
    })),
  });
}

export const mapInventoryStore: MapInventoryStore = createDerivedStore(
  'glossa-map-inventories',
  inventoryPointsSchema,
);
