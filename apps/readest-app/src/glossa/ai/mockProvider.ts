import type { GlossaAnswer } from './answer';
import type { AIProvider, AIProviderEvent, AIProviderRequest } from './provider';

const abortError = () => new DOMException('Glossa request aborted', 'AbortError');

const splitForStream = (text: string): [string, string] => {
  const splitAt = Math.max(1, Math.ceil(Array.from(text).length / 2));
  const characters = Array.from(text);
  return [characters.slice(0, splitAt).join(''), characters.slice(splitAt).join('')];
};

/** A deterministic no-network provider for the first end-to-end reading loop. */
export class MockProvider implements AIProvider {
  async *stream(request: AIProviderRequest, signal: AbortSignal): AsyncGenerator<AIProviderEvent> {
    const selection = request.contextPack.segments.find(({ role }) => role === 'selection');
    if (!selection) {
      yield {
        type: 'error',
        error: { code: 'invalid-response', message: 'Missing selection evidence' },
      };
      return;
    }
    const previous = request.contextPack.segments.find(({ role }) => role === 'previous');
    const answer: GlossaAnswer =
      request.action === 'relate' && !previous
        ? { status: 'insufficient_evidence', paragraphs: [], followups: [] }
        : request.action === 'translate'
          ? {
              status: 'answered',
              paragraphs: [
                {
                  text: `翻译（Mock）：${selection.text}`,
                  sourceIds: [selection.sourceId],
                  basis: 'document',
                },
              ],
              followups: [],
            }
          : request.action === 'relate'
            ? {
                status: 'answered',
                paragraphs: [
                  {
                    text: `联系前文（Mock）：选区“${selection.text}”延续了前文“${previous!.text}”。`,
                    sourceIds: [previous!.sourceId, selection.sourceId],
                    basis: 'document',
                  },
                ],
                followups: [],
              }
            : {
                status: 'answered',
                paragraphs: [
                  {
                    text: `解释（Mock）：“${selection.text}”是当前选区中的表述，应结合原文理解。`,
                    sourceIds: [selection.sourceId],
                    basis: 'document',
                  },
                ],
                followups: [],
              };
    const text =
      answer.status === 'answered' ? answer.paragraphs[0]!.text : '证据不足：没有可用前文。';
    const chunks = splitForStream(text);
    for (const chunk of chunks) {
      if (signal.aborted) throw abortError();
      yield { type: 'text-delta', text: chunk };
    }
    if (signal.aborted) throw abortError();
    yield { type: 'complete', answer };
  }
}
