import type { GlossaAnswer, GlossaChapterSummary } from './answer';
import {
  getFreeQuestion,
  getHistorySummary,
  type AIProvider,
  type AIProviderEvent,
  type AIProviderRequest,
} from './provider';

const abortError = () => new DOMException('Glossa request aborted', 'AbortError');

const splitForStream = (text: string): [string, string] => {
  const splitAt = Math.max(1, Math.ceil(Array.from(text).length / 2));
  const characters = Array.from(text);
  return [characters.slice(0, splitAt).join(''), characters.slice(splitAt).join('')];
};

// This is intentionally a small safety gate, not a pretend language model.
// Questions asking for bibliographic or unseen-document facts have no evidence
// in C04's selection-only ContextPack.
const isClearlyOutsideEvidence = (question: string): boolean =>
  /\b(author|writer|published|publication|year|chapter\s+[2-9]|whole book)\b|作者|作者是谁|出版|哪一年|后文|全文/u.test(
    question,
  );

/** A deterministic no-network provider for the first end-to-end reading loop. */
export class MockProvider implements AIProvider {
  readonly modelVersion = 'mock-v1';

  async *stream(request: AIProviderRequest, signal: AbortSignal): AsyncGenerator<AIProviderEvent> {
    if (request.action === 'summarize-read-section') {
      const readBlocks = request.contextPack.segments.filter(({ role }) => role === 'chapter');
      const answer: GlossaChapterSummary =
        readBlocks.length === 0
          ? {
              status: 'insufficient_evidence',
              corePoints: [],
              evidence: [],
              concepts: [],
              openQuestions: [],
            }
          : {
              status: 'summarized',
              corePoints: [
                {
                  text: `核心观点（Mock）：${readBlocks[0]!.text}`,
                  sourceIds: [readBlocks[0]!.sourceId],
                },
              ],
              evidence: [
                {
                  text: `证据（Mock）：${readBlocks.at(-1)!.text}`,
                  sourceIds: [readBlocks.at(-1)!.sourceId],
                },
              ],
              concepts: [],
              openQuestions: [],
            };
      const text =
        answer.status === 'summarized'
          ? answer.corePoints[0]!.text
          : '证据不足：当前章节没有已读来源。';
      for (const chunk of splitForStream(text)) {
        if (signal.aborted) throw abortError();
        yield { type: 'text-delta', text: chunk };
      }
      if (signal.aborted) throw abortError();
      yield { type: 'complete', answer };
      return;
    }
    const selection = request.contextPack.segments.find(({ role }) => role === 'selection');
    if (!selection) {
      yield {
        type: 'error',
        error: { code: 'invalid-response', message: 'Missing selection evidence' },
      };
      return;
    }
    const previous = request.contextPack.segments.find(({ role }) => role === 'previous');
    const question = getFreeQuestion(request);
    const historySummary = getHistorySummary(request);
    const answer: GlossaAnswer =
      question && isClearlyOutsideEvidence(question)
        ? { status: 'insufficient_evidence', paragraphs: [], followups: [] }
        : question
          ? {
              status: 'answered',
              paragraphs: [
                {
                  text: `回答（Mock）：关于“${question}”，当前选区“${selection.text}”是可验证的依据。${historySummary ? '这次追问保留了同一文档中先前问题的摘要。' : ''}`,
                  sourceIds: [selection.sourceId],
                  basis: 'document',
                },
              ],
              followups: [],
            }
          : request.action === 'relate' && !previous
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
                        basis: 'inference',
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
      answer.status === 'answered'
        ? answer.paragraphs[0]!.text
        : question
          ? '证据不足：当前选区没有支持这个问题的证据。'
          : '证据不足：没有可用前文。';
    const chunks = splitForStream(text);
    for (const chunk of chunks) {
      if (signal.aborted) throw abortError();
      yield { type: 'text-delta', text: chunk };
    }
    if (signal.aborted) throw abortError();
    yield { type: 'complete', answer };
  }
}
