import type { StudyNoteVersion, StudyParagraph } from './types';

const escapeHtml = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const heading = (text: string) =>
  escapeHtml(text)
    .replace(/[\r\n]+/g, ' ')
    .replace(/([\\[\]#])/g, '\\$1');

export function exportStudyNoteMarkdown(note: StudyNoteVersion, personalNote = ''): string {
  const cited = new Map<string, number>();
  const references = (sourceIds: string[]) =>
    sourceIds
      .map((sourceId) => {
        if (!cited.has(sourceId)) cited.set(sourceId, cited.size + 1);
        return `[^${cited.get(sourceId)}]`;
      })
      .join('');
  const paragraph = (item: StudyParagraph) =>
    `${item.kind === 'inference' ? '**推断 / Inference：** ' : ''}${escapeHtml(item.text)} ${references(item.sourceIds)}`;
  const lines = [
    `# ${heading(note.chapterTitle)}`,
    '',
    `${heading(note.bookTitle)} · ${note.createdAt.slice(0, 10)} · ${heading(note.provider.model)}`,
    '',
    ...note.overview.flatMap((item) => [paragraph(item), '']),
  ];
  for (const section of note.sections) {
    lines.push(`## ${heading(section.heading)}`, '');
    for (const item of section.paragraphs) lines.push(paragraph(item), '');
  }
  if (note.insufficientEvidence)
    lines.push('> 部分内容证据不足 / Some source material was insufficient.', '');
  if (note.questions.length) {
    lines.push('## 复习问题 / Review questions', '');
    for (const [index, question] of note.questions.entries()) {
      lines.push(
        `### ${index + 1}. ${heading(question.question)}`,
        '',
        `${escapeHtml(question.answer)} ${references(question.sourceIds)}`,
        '',
      );
    }
  }
  if (personalNote.trim())
    lines.push('## 我的笔记 / Personal notes', '', escapeHtml(personalNote), '');
  if (cited.size) {
    lines.push('## 原文出处 / Sources', '');
    for (const [sourceId, number] of cited) {
      const source = note.sources.find((item) => item.sourceId === sourceId);
      if (!source) continue;
      const quote = escapeHtml(source.anchor.quote.exact).replace(/\n/g, '\n    ');
      lines.push(
        `[^${number}]: ${heading(note.chapterTitle)} · EPUB ${source.anchor.sectionIndex + 1}`,
        `    ${quote}`,
        `    \`${source.anchor.cfi.replaceAll('`', '')}\``,
        '',
      );
    }
  }
  return lines.join('\n');
}
