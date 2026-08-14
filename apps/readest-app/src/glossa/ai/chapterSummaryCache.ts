import { z } from 'zod';

import { sourceAnchorSchema } from '../citations/sourceAnchor';
import type { ContextPack } from '../context/contextPack';
import {
  glossaChapterSummarySchema,
  validateGlossaChapterSummary,
  type GlossaChapterSummary,
  type ValidatedGlossaChapterSummary,
} from './answer';

export const GLOSSA_CHAPTER_SUMMARY_CACHE_VERSION = 1;
export const GLOSSA_CHAPTER_SUMMARY_PROMPT_VERSION = 'v1';
export const GLOSSA_CHAPTER_SUMMARY_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_GLOSSA_CHAPTER_SUMMARY_CACHE_ENTRIES = 12;

const cacheKeySchema = z
  .object({
    documentHash: z.string().trim().min(1),
    sectionId: z.string().trim().min(1),
    modelVersion: z.string().trim().min(1),
    promptVersion: z.string().trim().min(1),
    evidenceFingerprint: z.string().regex(/^[0-9a-f]{16}$/u),
  })
  .strict();

const cacheEntrySchema = z
  .object({
    version: z.literal(GLOSSA_CHAPTER_SUMMARY_CACHE_VERSION),
    key: cacheKeySchema,
    createdAt: z.number().finite().nonnegative(),
    expiresAt: z.number().finite().nonnegative(),
    summary: glossaChapterSummarySchema,
  })
  .strict()
  .superRefine((entry, context) => {
    if (entry.expiresAt <= entry.createdAt) {
      context.addIssue({ code: 'custom', message: 'Cache expiry must follow creation time' });
    }
  });

export type GlossaChapterSummaryCacheEntry = z.infer<typeof cacheEntrySchema>;

export type ChapterSummaryCache = {
  read(options: {
    contextPack: ContextPack;
    modelVersion: string;
  }): ValidatedGlossaChapterSummary | null;
  write(options: {
    contextPack: ContextPack;
    modelVersion: string;
    summary: GlossaChapterSummary;
  }): void;
};

type CacheIdentity = {
  documentHash: string;
  sectionId: string;
  evidenceFingerprint: string;
};

const fnv1a64 = (value: string): string => {
  let hash = 0xcbf29ce484222325n;
  for (const character of value) {
    hash ^= BigInt(character.codePointAt(0) ?? 0);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
};

/**
 * Validate the live evidence before either deriving a key or using a cached
 * result. The cache never owns source text or anchors: it only accepts the
 * freshly reconstructed ContextPack as proof that every cached source remains
 * locally available and navigable.
 */
const getCacheIdentity = (contextPack: ContextPack): CacheIdentity | null => {
  if (contextPack.scope.kind !== 'read-section' || contextPack.segments.length === 0) return null;
  const readEvidenceFingerprint = contextPack.scope.evidenceFingerprint;
  if (!/^[0-9a-f]{16}$/u.test(readEvidenceFingerprint)) return null;
  const first = contextPack.segments[0]!;
  const documentHash = first.anchor.documentId;
  const sectionId = first.anchor.sectionId;
  if (!documentHash || !sectionId) return null;
  const evidence: string[] = [];
  for (const segment of contextPack.segments) {
    const anchor = sourceAnchorSchema.safeParse(segment.anchor);
    if (
      !anchor.success ||
      segment.role !== 'chapter' ||
      anchor.data.documentId !== documentHash ||
      anchor.data.sectionId !== sectionId ||
      segment.text !== anchor.data.quote.exact
    ) {
      return null;
    }
    evidence.push(
      [
        segment.sourceId,
        anchor.data.cfi ?? '',
        anchor.data.quote.exact,
        anchor.data.quote.prefix ?? '',
        anchor.data.quote.suffix ?? '',
      ].join('\u001f'),
    );
  }
  return {
    documentHash,
    sectionId,
    // The scope fingerprint changes when any fully read block changes, even if
    // that block is outside F02's 32-block request budget. The local segment
    // fingerprint additionally prevents a malformed ContextPack from reusing
    // a cache entry with the same scope marker.
    evidenceFingerprint: fnv1a64([readEvidenceFingerprint, ...evidence].join('\u001e')),
  };
};

const cacheKeyFor = (
  contextPack: ContextPack,
  modelVersion: string,
  promptVersion: string,
): z.infer<typeof cacheKeySchema> | null => {
  const identity = getCacheIdentity(contextPack);
  if (!identity || !modelVersion.trim() || !promptVersion.trim()) return null;
  return {
    ...identity,
    modelVersion: modelVersion.trim(),
    promptVersion: promptVersion.trim(),
  };
};

const sameKey = (
  left: z.infer<typeof cacheKeySchema>,
  right: z.infer<typeof cacheKeySchema>,
): boolean =>
  left.documentHash === right.documentHash &&
  left.sectionId === right.sectionId &&
  left.modelVersion === right.modelVersion &&
  left.promptVersion === right.promptVersion &&
  left.evidenceFingerprint === right.evidenceFingerprint;

/** Return a cache hit only after revalidating against current local evidence. */
export function readChapterSummaryCache(options: {
  entries: unknown;
  contextPack: ContextPack;
  modelVersion: string;
  promptVersion?: string;
  now?: number;
}): ValidatedGlossaChapterSummary | null {
  const key = cacheKeyFor(
    options.contextPack,
    options.modelVersion,
    options.promptVersion ?? GLOSSA_CHAPTER_SUMMARY_PROMPT_VERSION,
  );
  if (!key || !Array.isArray(options.entries)) return null;
  const now = options.now ?? Date.now();
  for (const value of options.entries) {
    const entry = cacheEntrySchema.safeParse(value);
    if (!entry.success || entry.data.expiresAt <= now || !sameKey(entry.data.key, key)) continue;
    const validated = validateGlossaChapterSummary(entry.data.summary, options.contextPack);
    if (validated.ok) return validated;
  }
  return null;
}

/**
 * Produce a bounded local-only replacement value. Invalid old entries are
 * discarded rather than trusted, and no ContextPack source text is retained.
 */
export function writeChapterSummaryCache(options: {
  entries: unknown;
  contextPack: ContextPack;
  modelVersion: string;
  summary: GlossaChapterSummary;
  promptVersion?: string;
  now?: number;
}): GlossaChapterSummaryCacheEntry[] | null {
  const promptVersion = options.promptVersion ?? GLOSSA_CHAPTER_SUMMARY_PROMPT_VERSION;
  const key = cacheKeyFor(options.contextPack, options.modelVersion, promptVersion);
  const validated = validateGlossaChapterSummary(options.summary, options.contextPack);
  if (!key || !validated.ok) return null;
  const now = options.now ?? Date.now();
  const entry: GlossaChapterSummaryCacheEntry = {
    version: GLOSSA_CHAPTER_SUMMARY_CACHE_VERSION,
    key,
    createdAt: now,
    expiresAt: now + GLOSSA_CHAPTER_SUMMARY_CACHE_MAX_AGE_MS,
    summary: validated.summary,
  };
  const existing = Array.isArray(options.entries) ? options.entries : [];
  const retained = existing
    .map((value) => cacheEntrySchema.safeParse(value))
    .filter(
      (value): value is { success: true; data: GlossaChapterSummaryCacheEntry } => value.success,
    )
    .map(({ data }) => data)
    .filter((value) => value.expiresAt > now && !sameKey(value.key, key));
  return [entry, ...retained]
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, MAX_GLOSSA_CHAPTER_SUMMARY_CACHE_ENTRIES);
}
