import { md5 } from 'js-md5';
import type { ChapterContent, ChapterSource } from '@/glossa/context/types';
import { stubTranslation as _ } from '@/utils/misc';
import { GuideError, type ReadingPassage } from './types';

export const PASSAGE_TARGET_CHARACTERS = 20000;
export const PASSAGE_MAX_CHARACTERS = 20000;
export const PASSAGE_MAX_SOURCES = 200;

/** IDs locate a passage; the separate cache hash detects edits to its text and anchors. */
export function getPassageId(chapterId: string, sources: ChapterSource[]): string {
  return `${chapterId}:passage:${md5(JSON.stringify(sources.map((source) => source.sourceId)))}`;
}

/** Keep the adapter's complete semantic blocks and original anchors, never text excerpts. */
export function buildReadingPassages(content: ChapterContent): ReadingPassage[] {
  if (new Set(content.sources.map((source) => source.sourceId)).size !== content.sources.length)
    throw new GuideError('unavailable', _('The passage sources could not be verified.'));
  const passages: ReadingPassage[] = [];
  let pending: ChapterSource[] = [];
  let count = 0;
  const flush = () => {
    if (!pending.length) return;
    const firstHeading = pending.find((source) => source.kind === 'heading');
    passages.push({
      id: getPassageId(content.chapter.id, pending),
      index: passages.length,
      title: firstHeading?.text ?? content.chapter.title,
      sources: pending,
      characterCount: count,
      unavailable:
        count > PASSAGE_MAX_CHARACTERS ||
        pending.length > PASSAGE_MAX_SOURCES ||
        pending.every((source) => source.kind === 'heading'),
    });
    pending = [];
    count = 0;
  };
  for (let index = 0; index < content.sources.length; index++) {
    const group = [content.sources[index]!];
    // A run of headings and its first following block are one structural unit.
    // If that unit exceeds the budget, keep it complete and unavailable.
    while (group.at(-1)!.kind === 'heading' && index + 1 < content.sources.length) {
      group.push(content.sources[++index]!);
    }
    const size = group.reduce((total, source) => total + source.text.length, 0);
    if (
      pending.length &&
      (count >= PASSAGE_TARGET_CHARACTERS ||
        count + size > PASSAGE_MAX_CHARACTERS ||
        pending.length + group.length > PASSAGE_MAX_SOURCES ||
        group[0]!.kind === 'heading')
    )
      flush();
    pending.push(...group);
    count += size;
    if (count > PASSAGE_MAX_CHARACTERS || pending.length > PASSAGE_MAX_SOURCES) flush();
  }
  flush();
  return passages;
}
