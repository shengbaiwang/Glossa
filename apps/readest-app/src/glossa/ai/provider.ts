import type { ContextPack } from '../context/contextPack';

export type GlossaAction = 'explain' | 'translate' | 'relate';

export type ProviderError = {
  code: 'aborted' | 'provider-error' | 'invalid-response';
  message: string;
};

export type AIProviderEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'complete'; answer: unknown }
  | { type: 'error'; error: ProviderError };

export type AIProviderRequest = {
  action: GlossaAction;
  contextPack: ContextPack;
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
