import type { ChapterSource } from '@/glossa/context/types';

export const NOTE_CHUNK_CHARACTERS = 12000;

// Normal paragraphs are indivisible. Exceptionally long paragraphs/tables are
// split at sentence boundaries, retaining their original local source anchor.
function splitLongSource(source: ChapterSource, limit: number): ChapterSource[] {
  const characters = Array.from(source.text);
  const parts: ChapterSource[] = [];
  for (let start = 0; start < characters.length; ) {
    let end = Math.min(start + limit, characters.length);
    if (end < characters.length) {
      const minimum = start + Math.floor(limit / 2);
      for (let cursor = end - 1; cursor >= minimum; cursor--) {
        if (/[。！？.!?;；\n]/u.test(characters[cursor]!)) {
          end = cursor + 1;
          break;
        }
      }
    }
    parts.push({ ...source, text: characters.slice(start, end).join('') });
    start = end;
  }
  return parts;
}

export function splitNoteSources(
  sources: ChapterSource[],
  limit = NOTE_CHUNK_CHARACTERS,
): ChapterSource[][] {
  if (!Number.isSafeInteger(limit) || limit < 2) throw new Error('Invalid chunk size');
  const blocks = sources
    .filter((source) => source.text.trim())
    .flatMap((source) => splitLongSource(source, limit));
  const chunks: ChapterSource[][] = [];
  let chunk: ChapterSource[] = [];
  let count = 0;
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index]!;
    const length = Array.from(block.text).length;
    const nextLength =
      block.kind === 'heading' ? Array.from(blocks[index + 1]?.text ?? '').length : 0;
    if (
      chunk.length &&
      (count + length > limit ||
        (nextLength && length + nextLength <= limit && count + length + nextLength > limit))
    ) {
      chunks.push(chunk);
      chunk = [];
      count = 0;
    }
    chunk.push(block);
    count += length;
  }
  if (chunk.length) chunks.push(chunk);
  return chunks;
}
