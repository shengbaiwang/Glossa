import { validateGlossaAnswer, type ValidatedGlossaAnswer } from './answer';
import type { AIProvider, AIProviderRequest, ProviderError } from './provider';

export type GlossaRequestHandlers = {
  onText(text: string): void;
  onComplete(result: ValidatedGlossaAnswer): void;
  onCancelled(): void;
  onError(error: ProviderError): void;
};

type ActiveRequest = {
  controller: AbortController;
  handlers: GlossaRequestHandlers;
  settled: boolean;
};

const isAbortError = (error: unknown): boolean =>
  error instanceof DOMException && error.name === 'AbortError';

/**
 * Keeps request replacement independent from React. A stale stream can never
 * call a new panel's handlers after it has been cancelled or superseded.
 */
export class GlossaRequestController {
  private active: ActiveRequest | null = null;

  constructor(private readonly provider: AIProvider) {}

  cancel(): void {
    const active = this.active;
    this.active = null;
    if (!active || active.settled) return;
    active.settled = true;
    active.controller.abort();
    active.handlers.onCancelled();
  }

  async run(request: AIProviderRequest, handlers: GlossaRequestHandlers): Promise<void> {
    this.cancel();
    const active: ActiveRequest = { controller: new AbortController(), handlers, settled: false };
    this.active = active;
    try {
      for await (const event of this.provider.stream(request, active.controller.signal)) {
        if (this.active !== active || active.settled) return;
        if (event.type === 'text-delta') {
          handlers.onText(event.text);
          continue;
        }
        if (event.type === 'error') {
          active.settled = true;
          this.active = null;
          handlers.onError(event.error);
          return;
        }
        const validation = validateGlossaAnswer(event.answer, request.contextPack);
        active.settled = true;
        this.active = null;
        if (!validation.ok) {
          handlers.onError({
            code: 'invalid-response',
            message: `Glossa provider returned ${validation.reason}`,
          });
          return;
        }
        handlers.onComplete(validation);
        return;
      }
      if (this.active !== active || active.settled) return;
      active.settled = true;
      this.active = null;
      handlers.onError({
        code: 'invalid-response',
        message: 'Glossa provider ended without a completion result',
      });
    } catch (error) {
      if (this.active !== active || active.settled) return;
      active.settled = true;
      this.active = null;
      if (isAbortError(error)) handlers.onCancelled();
      else handlers.onError({ code: 'provider-error', message: 'Glossa provider request failed' });
    }
  }

  dispose(): void {
    this.cancel();
  }
}
