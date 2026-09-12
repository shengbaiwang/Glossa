import { validateProviderConfig, type ProviderConfig } from '@/glossa/ai/provider';
import type { ChapterSource } from '@/glossa/context/types';

export const READING_GUIDE_PROMPT_VERSION = 'reading-guide-2';
export const READING_GUIDE_SCHEMA_VERSION = 1;

async function hash(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function getGuideIdentity(
  bookId: string,
  passageId: string,
  sources: ChapterSource[],
  input: ProviderConfig,
): Promise<{ contentHash: string; cacheKey: string }> {
  const config = validateProviderConfig(input);
  // Select fields explicitly so object key order never changes a persisted identity.
  const contentHash = await hash(
    sources.map((source) => ({
      sourceId: source.sourceId,
      text: source.text,
      kind: source.kind,
      anchor: {
        sectionIndex: source.anchor.sectionIndex,
        cfi: source.anchor.cfi,
        quote: {
          exact: source.anchor.quote.exact,
          prefix: source.anchor.quote.prefix,
          suffix: source.anchor.quote.suffix,
        },
      },
    })),
  );
  const cacheKey = await hash({
    bookId,
    passageId,
    contentHash,
    providerId: config.id,
    baseUrl: config.baseUrl,
    model: config.model,
    promptVersion: READING_GUIDE_PROMPT_VERSION,
    schemaVersion: READING_GUIDE_SCHEMA_VERSION,
  });
  return { contentHash, cacheKey };
}
