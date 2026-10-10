import { queryTerms } from './retrieval';

/** Extractive packing: keep complete exchanges, never turn a model summary into a source. */
export function chooseReadingTurns<T extends { question: string; text: string }>(
  turns: T[],
  question: string,
): T[] {
  const terms = queryTerms(question);
  const latest = turns.length - 1;
  return turns
    .map((turn, index) => ({
      turn,
      index,
      score: terms.reduce(
        (score, term) =>
          score + (turn.question.includes(term) ? 3 : 0) + (turn.text.includes(term) ? 1 : 0),
        0,
      ),
    }))
    .sort(
      (a, b) =>
        Number(b.index === latest) - Number(a.index === latest) ||
        b.score - a.score ||
        b.index - a.index,
    )
    .map(({ turn }) => turn);
}
