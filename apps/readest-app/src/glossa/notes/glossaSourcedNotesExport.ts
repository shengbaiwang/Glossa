import { z } from 'zod';

import {
  getGlossaSourcedNoteOriginal,
  getGlossaSourcedNoteUserNote,
  glossaSourcedNoteSchema,
  readGlossaSourcedNotes,
  type GlossaSourcedNote,
} from './glossaSourcedNotes';

/** The stable file format version for a current-document Glossa note export. */
export const GLOSSA_SOURCED_NOTES_EXPORT_VERSION = 1;

export const glossaSourcedNotesExportSchema = z
  .object({
    version: z.literal(GLOSSA_SOURCED_NOTES_EXPORT_VERSION),
    documentId: z.string().trim().min(1),
    notes: z.array(glossaSourcedNoteSchema),
  })
  .strict()
  .superRefine((value, context) => {
    value.notes.forEach((note, index) => {
      if (note.documentId !== value.documentId) {
        context.addIssue({
          code: 'custom',
          path: ['notes', index, 'documentId'],
          message: 'Exported note document does not match the export document',
        });
      }
    });
  });

export type GlossaSourcedNotesExport = z.infer<typeof glossaSourcedNotesExportSchema>;

/**
 * Exports only records which pass the existing V1–V3 validation for this
 * document. The original persisted objects are retained, so source anchors
 * and their order are not normalized away during JSON export.
 */
export const createGlossaSourcedNotesExport = (
  entries: unknown,
  documentId: string,
): GlossaSourcedNotesExport => {
  const exportData = {
    version: GLOSSA_SOURCED_NOTES_EXPORT_VERSION,
    documentId,
    notes: readGlossaSourcedNotes(entries, documentId),
  };
  return glossaSourcedNotesExportSchema.parse(exportData);
};

export const serializeGlossaSourcedNotesJson = (entries: unknown, documentId: string): string =>
  `${JSON.stringify(createGlossaSourcedNotesExport(entries, documentId), null, 2)}\n`;

const blockquote = (text: string): string =>
  text
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');

const inlineCode = (text: string): string => `\`${text.replaceAll('`', '\\`')}\``;

const sourceMarkdown = (source: GlossaSourcedNote['sources'][number], index: number): string[] => {
  const { anchor } = source;
  const location = [
    `- Source ID: ${inlineCode(source.sourceId)}`,
    `- Format: ${anchor.format}`,
    `- Document ID: ${inlineCode(anchor.documentId)}`,
  ];
  if (anchor.sectionId) location.push(`- Section: ${inlineCode(anchor.sectionId)}`);
  if (anchor.cfi) location.push(`- CFI: ${inlineCode(anchor.cfi)}`);
  if (anchor.quote.prefix) location.push(`- Quote prefix: ${blockquote(anchor.quote.prefix)}`);
  location.push('- Source text:', blockquote(source.text));
  if (anchor.quote.suffix) location.push(`- Quote suffix: ${blockquote(anchor.quote.suffix)}`);
  return [`### Source ${index + 1}`, ...location];
};

const actionLabel: Record<'explain' | 'translate' | 'relate', string> = {
  explain: 'Explain selected text',
  translate: 'Translate selected text',
  relate: 'Connect selected text to previous context',
};

const noteMarkdown = (note: GlossaSourcedNote, index: number): string[] => {
  const original = getGlossaSourcedNoteOriginal(note);
  const lines = [`## Note ${index + 1}`, `- Note ID: ${inlineCode(note.id)}`];

  if (original.version === 2) {
    lines.push('', '### Selection', blockquote(original.context.selection.text), '', '### Request');
    lines.push(
      'action' in original.context.request
        ? actionLabel[original.context.request.action]
        : original.context.request.question,
    );
  } else {
    lines.push('', '_This V1 note has no saved selection or request context._');
  }

  lines.push(
    '',
    '### AI answer',
    blockquote(original.version === 2 ? original.answer.text : original.answer),
  );
  const userNote = getGlossaSourcedNoteUserNote(note);
  if (userNote) lines.push('', '### Personal note', blockquote(userNote));
  note.sources.forEach((source, sourceIndex) => {
    lines.push('', ...sourceMarkdown(source, sourceIndex));
  });
  return lines;
};

export const serializeGlossaSourcedNotesMarkdown = (
  entries: unknown,
  documentId: string,
): string => {
  const exportData = createGlossaSourcedNotesExport(entries, documentId);
  const lines = [
    '# Glossa sourced notes',
    '',
    `Document ID: ${inlineCode(exportData.documentId)}`,
    `Export format version: ${GLOSSA_SOURCED_NOTES_EXPORT_VERSION}`,
  ];
  if (exportData.notes.length === 0) {
    lines.push('', '_No valid Glossa sourced notes were saved for this document._');
  } else {
    exportData.notes.forEach((note, index) => lines.push('', ...noteMarkdown(note, index)));
  }
  return `${lines.join('\n')}\n`;
};
