import { validateGlossaAnswer, type ValidatedGlossaAnswer } from './answer';
import type {
  AIProvider,
  AIProviderRequest,
  ProviderError,
  StructuralRepairReason,
} from './provider';

export type GlossaRequestHandlers = {
  onText(text: string): void;
  onRepairing(): void;
  onComplete(result: ValidatedGlossaAnswer): void;
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
    const runAttempt = async (
      attempt: AIProviderRequest,
    ): Promise<StructuralRepairReason | null> => {
      for await (const event of this.provider.stream(attempt, active.controller.signal)) {
        if (this.active !== active || active.settled) return null;
        if (event.type === 'text-delta') {
          handlers.onText(event.text);
          continue;
        }
        if (event.type === 'error') {
          const repairReason = repairReasonForError(event.error);
          if (repairReason) return repairReason;
          active.settled = true;
          this.active = null;
          handlers.onError(event.error);
          return null;
        }
        const validation = validateGlossaAnswer(event.answer, request.contextPack);
        if (!validation.ok) return validation.reason;
        active.settled = true;
        this.active = null;
        handlers.onComplete(validation);
        return null;
      }
      if (this.active !== active || active.settled) return null;
      active.settled = true;
      this.active = null;
      handlers.onError({
        code: 'invalid-response',
        message: 'Glossa provider ended without a completion result',
      });
      return null;
    };
    try {
      const repairReason = await runAttempt(request);
      if (this.active !== active || active.settled || !repairReason) return;
      handlers.onRepairing();
      const retryReason = await runAttempt({ ...request, repair: { reason: repairReason } });
      if (this.active !== active || active.settled || !retryReason) return;
      active.settled = true;
      this.active = null;
      handlers.onError({
        code: 'invalid-response',
        message: 'Glossa could not verify the repaired answer.',
        repairReason: retryReason,
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
