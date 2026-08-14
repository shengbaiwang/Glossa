import type { ContextPack } from '../context/contextPack';
import { isGlossaHistorySummary } from './historySummary';

export type GlossaAction = 'explain' | 'translate' | 'relate' | 'summarize-read-section';

/**
 * A compact conversation cue for a new request. It intentionally contains no
 * prior answer text, source IDs, anchors, or EPUB excerpts: those must always
 * come from the current ContextPack.
 */
export type GlossaHistorySummary = {
  documentId: string;
  text: string;
  turnCount: number;
};

export type ProviderError = {
  code:
    | 'aborted'
    | 'missing-key'
    | 'invalid-auth'
    | 'insufficient-balance'
    | 'invalid-request'
    | 'rate-limited'
    | 'server-error'
    | 'overloaded'
    | 'timeout'
    | 'network-error'
    | 'provider-error'
    | 'invalid-response';
  message: string;
  /** Present only for the bounded, safe-to-repair response failures. */
  repairReason?: StructuralRepairReason;
};

export type StructuralRepairReason =
  | 'empty-json'
  | 'invalid-json'
  | 'invalid-schema'
  | 'unknown-source-id'
  | 'duplicate-source-id'
  | 'external-basis';

/** Actual token accounting returned by a provider, never locally inferred. */
export type AIProviderUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
};

export type AIProviderEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'usage'; usage: AIProviderUsage }
  | { type: 'complete'; answer: unknown }
  | { type: 'error'; error: ProviderError };

export type AIProviderRequest = {
  /** Existing selection actions stay supported for the current reading loop. */
  action?: GlossaAction;
  /** A plain-text question bound to the same selected evidence. */
  question?: string;
  contextPack: ContextPack;
  /** Bounded, document-scoped conversation metadata for follow-up questions. */
  historySummary?: GlossaHistorySummary;
  /** A controller-only bounded repair instruction; never includes prior output. */
  repair?: { reason: StructuralRepairReason };
};

const contextPackId = (contextPack: ContextPack): string =>
  contextPack.segments.map(({ sourceId }) => sourceId).join('|');

export const getContextPackId = contextPackId;

/** Return only a valid summary for the document currently being read. */
export function getHistorySummary(request: AIProviderRequest): GlossaHistorySummary | null {
  const documentId = request.contextPack.segments[0]?.anchor.documentId;
  const summary = request.historySummary;
  if (
    !documentId ||
    !isGlossaHistorySummary(summary) ||
    summary.documentId !== documentId ||
    !summary.text.trim()
  ) {
    return null;
  }
  return summary;
}

export const getFreeQuestion = (request: AIProviderRequest): string | null => {
  const question = request.question?.trim();
  return question ? question : null;
};

/** Model-neutral, stream-first protocol. Implementations never receive DOM or reader state. */
export interface AIProvider {
  /** Omit this only for non-cacheable test or experimental providers. */
  readonly modelVersion?: string;
  stream(request: AIProviderRequest, signal: AbortSignal): AsyncIterable<AIProviderEvent>;
}

/** A missing version is intentionally non-cacheable: identity must be explicit. */
export const getAIProviderModelVersion = (provider: AIProvider): string | null => {
  const value = typeof provider.modelVersion === 'string' ? provider.modelVersion.trim() : '';
  return value || null;
};

export type ProviderResponse = {
  events: AIProviderEvent[];
  text: string;
  answer?: unknown;
  error?: ProviderError;
  usage?: AIProviderUsage;
};

export async function collectProviderResponse(
  provider: AIProvider,
  request: AIProviderRequest,
  signal = new AbortController().signal,
): Promise<ProviderResponse> {
  const events: AIProviderEvent[] = [];
  let text = '';
  let answer: unknown;
  let error: ProviderError | undefined;
  let usage: AIProviderUsage | undefined;
  for await (const event of provider.stream(request, signal)) {
    events.push(event);
    if (event.type === 'text-delta') text += event.text;
    if (event.type === 'usage') usage = event.usage;
    if (event.type === 'complete') answer = event.answer;
    if (event.type === 'error') error = event.error;
  }
  return {
    events,
    text,
    ...(answer === undefined ? {} : { answer }),
    ...(error ? { error } : {}),
    ...(usage ? { usage } : {}),
  };
}
