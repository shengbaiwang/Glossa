import type { ContextPack } from '../context/contextPack';
import type { GlossaAnswer } from './answer';

export type GlossaAction = 'explain' | 'translate' | 'relate';
export const MAX_GLOSSA_HISTORY_TURNS = 3;

export type GlossaConversationTurn = {
  documentId: string;
  contextPackId: string;
  user: { role: 'user'; text: string };
  assistant: { role: 'assistant'; text: string; answer: GlossaAnswer };
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

export type AIProviderEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'complete'; answer: unknown }
  | { type: 'error'; error: ProviderError };

export type AIProviderRequest = {
  /** Existing selection actions stay supported for the current reading loop. */
  action?: GlossaAction;
  /** A plain-text question bound to the same selected evidence. */
  question?: string;
  contextPack: ContextPack;
  /** Complete turns only; providers receive at most the last three. */
  history?: GlossaConversationTurn[];
  /** A controller-only bounded repair instruction; never includes prior output. */
  repair?: { reason: StructuralRepairReason };
};

const contextPackId = (contextPack: ContextPack): string =>
  contextPack.segments.map(({ sourceId }) => sourceId).join('|');

export const getContextPackId = contextPackId;

/**
 * Rejects another document or evidence set and trims only at whole-turn
 * boundaries. This is deliberately provider-neutral and JSON-safe.
 */
export function getBoundedHistory(request: AIProviderRequest): GlossaConversationTurn[] {
  const documentId = request.contextPack.segments[0]?.anchor.documentId;
  if (!documentId) return [];
  const expectedContextPackId = contextPackId(request.contextPack);
  return (request.history ?? [])
    .filter(
      (turn) =>
        turn.documentId === documentId &&
        turn.contextPackId === expectedContextPackId &&
        turn.user.role === 'user' &&
        turn.assistant.role === 'assistant',
    )
    .slice(-MAX_GLOSSA_HISTORY_TURNS);
}

export const getFreeQuestion = (request: AIProviderRequest): string | null => {
  const question = request.question?.trim();
  return question ? question : null;
};

/** Model-neutral, stream-first protocol. Implementations never receive DOM or reader state. */
export interface AIProvider {
  stream(request: AIProviderRequest, signal: AbortSignal): AsyncIterable<AIProviderEvent>;
}

export type ProviderResponse = {
  events: AIProviderEvent[];
  text: string;
  answer?: unknown;
  error?: ProviderError;
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
  for await (const event of provider.stream(request, signal)) {
    events.push(event);
    if (event.type === 'text-delta') text += event.text;
    if (event.type === 'complete') answer = event.answer;
    if (event.type === 'error') error = event.error;
  }
  return { events, text, ...(answer === undefined ? {} : { answer }), ...(error ? { error } : {}) };
}
