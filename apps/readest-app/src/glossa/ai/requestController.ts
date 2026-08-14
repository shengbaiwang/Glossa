import {
  validateGlossaAnswer,
  validateGlossaChapterSummary,
  type ValidatedGlossaResult,
} from './answer';
import type {
  AIProvider,
  AIProviderRequest,
  AIProviderUsage,
  ProviderError,
  StructuralRepairReason,
} from './provider';

export type GlossaRequestHandlers = {
  onText(text: string): void;
  onRepairing(): void;
  onComplete(result: ValidatedGlossaResult, usage: AIProviderUsage | null): void;
  onCancelled(): void;
  onError(error: ProviderError): void;
};

const repairReasonForError = (error: ProviderError): StructuralRepairReason | null =>
  error.code === 'invalid-response' ? (error.repairReason ?? null) : null;

type ActiveRequest = {
  controller: AbortController;
  handlers: GlossaRequestHandlers;
  settled: boolean;
};

type AttemptOutcome =
  | { type: 'complete'; result: ValidatedGlossaResult; usage: AIProviderUsage | null }
  | { type: 'repair'; reason: StructuralRepairReason; usage: AIProviderUsage | null }
  | { type: 'error'; error: ProviderError };

const addUsage = (left: AIProviderUsage, right: AIProviderUsage): AIProviderUsage => ({
  inputTokens: left.inputTokens + right.inputTokens,
  outputTokens: left.outputTokens + right.outputTokens,
  cacheHitTokens: left.cacheHitTokens + right.cacheHitTokens,
  cacheMissTokens: left.cacheMissTokens + right.cacheMissTokens,
});

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
    const runAttempt = async (attempt: AIProviderRequest): Promise<AttemptOutcome | null> => {
      let usage: AIProviderUsage | null = null;
      for await (const event of this.provider.stream(attempt, active.controller.signal)) {
        if (this.active !== active || active.settled) return null;
        if (event.type === 'text-delta') {
          handlers.onText(event.text);
          continue;
        }
        if (event.type === 'usage') {
          usage = event.usage;
          continue;
        }
        if (event.type === 'error') {
          const repairReason = repairReasonForError(event.error);
          return repairReason
            ? { type: 'repair', reason: repairReason, usage }
            : { type: 'error', error: event.error };
        }
        const validation =
          request.action === 'summarize-read-section'
            ? validateGlossaChapterSummary(event.answer, request.contextPack)
            : validateGlossaAnswer(event.answer, request.contextPack);
        return validation.ok
          ? { type: 'complete', result: validation, usage }
          : { type: 'repair', reason: validation.reason, usage };
      }
      return this.active !== active || active.settled
        ? null
        : {
            type: 'error',
            error: {
              code: 'invalid-response',
              message: 'Glossa provider ended without a completion result',
            },
          };
    };
    try {
      const first = await runAttempt(request);
      if (this.active !== active || active.settled || !first) return;
      if (first.type === 'error') {
        active.settled = true;
        this.active = null;
        handlers.onError(first.error);
        return;
      }
      if (first.type === 'complete') {
        active.settled = true;
        this.active = null;
        handlers.onComplete(first.result, first.usage);
        return;
      }
      handlers.onRepairing();
      const retry = await runAttempt({ ...request, repair: { reason: first.reason } });
      if (this.active !== active || active.settled || !retry) return;
      if (retry.type === 'complete') {
        active.settled = true;
        this.active = null;
        handlers.onComplete(
          retry.result,
          first.usage && retry.usage ? addUsage(first.usage, retry.usage) : null,
        );
        return;
      }
      active.settled = true;
      this.active = null;
      handlers.onError(
        retry.type === 'error'
          ? retry.error
          : {
              code: 'invalid-response',
              message: 'Glossa could not verify the repaired answer.',
              repairReason: retry.reason,
            },
      );
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
