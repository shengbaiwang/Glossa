import type { GlossaHistorySummary } from './provider';

export const MAX_GLOSSA_HISTORY_SUMMARY_CHARACTERS = 1_200;
export const MAX_GLOSSA_HISTORY_SUMMARY_TURNS = 6;

type ConversationSummaryInput = {
  documentId: string;
  question: string;
  status: 'answered' | 'insufficient_evidence';
};

const characterLength = (text: string): number => Array.from(text).length;
const normalizeQuestion = (question: string): string => question.replace(/\s+/gu, ' ').trim();
const summaryLinePattern = /^先前问题：.+（(?:已回答|证据不足)）$/u;

/**
 * Preserve only user topics and whether they received evidence. Old assistant
 * prose can contain facts that are unsupported by a new ContextPack, so it is
 * deliberately never copied into this summary.
 */
export const createGlossaHistorySummary = (
  documentId: string,
  turns: ConversationSummaryInput[],
): GlossaHistorySummary | null => {
  const selected: string[] = [];
  for (const turn of turns.slice(-MAX_GLOSSA_HISTORY_SUMMARY_TURNS).reverse()) {
    if (turn.documentId !== documentId) continue;
    const status = turn.status === 'answered' ? '已回答' : '证据不足';
    const question = normalizeQuestion(turn.question);
    const line = `先前问题：${question}（${status}）`;
    if (!question || characterLength(line) > MAX_GLOSSA_HISTORY_SUMMARY_CHARACTERS) continue;
    if (characterLength([...selected, line].join('\n')) > MAX_GLOSSA_HISTORY_SUMMARY_CHARACTERS) {
      continue;
    }
    selected.unshift(line);
  }
  if (!documentId || selected.length === 0) return null;
  return { documentId, text: selected.join('\n'), turnCount: selected.length };
};

/** Reject malformed external input instead of turning it into hidden history. */
export const isGlossaHistorySummary = (value: unknown): value is GlossaHistorySummary => {
  if (!value || typeof value !== 'object') return false;
  const summary = value as Record<string, unknown>;
  if (
    typeof summary['documentId'] !== 'string' ||
    !summary['documentId'].trim() ||
    typeof summary['text'] !== 'string' ||
    !summary['text'].trim() ||
    characterLength(summary['text']) > MAX_GLOSSA_HISTORY_SUMMARY_CHARACTERS ||
    !Number.isInteger(summary['turnCount']) ||
    typeof summary['turnCount'] !== 'number' ||
    summary['turnCount'] < 1 ||
    summary['turnCount'] > MAX_GLOSSA_HISTORY_SUMMARY_TURNS
  ) {
    return false;
  }
  const lines = summary['text'].split('\n');
  return (
    lines.length === summary['turnCount'] && lines.every((line) => summaryLinePattern.test(line))
  );
};
