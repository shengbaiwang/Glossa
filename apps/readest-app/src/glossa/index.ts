/**
 * Public entry point for Glossa's reader-assistance module.
 *
 * The first EPUB vertical slice uses only the bounded `context`, `ai`, `ui`,
 * and `citations` contracts below. Reader persistence stays behind UI
 * adapters; sourced-note protocol types are public for future readers.
 */
export { isGlossaEnabled } from './featureFlag';
export { createEpubDocumentAdapter } from './context/epubAdapter';
export {
  createChapterToSelectionContextPack,
  createReadSectionContextPack,
  createContextPack,
  addReadKeywordCandidates,
  MAX_CHAPTER_CONTEXT_CHARACTERS,
  MAX_CHAPTER_CONTEXT_SEGMENTS,
  MAX_REQUEST_CONTEXT_CHARACTERS,
  MAX_REQUEST_CONTEXT_SEGMENTS,
} from './context/contextPack';
export { createEpubAnchorNavigator } from './context/epubNavigation';
export type { EpubAnchorNavigatorOptions, EpubNavigationRuntime } from './context/epubNavigation';
export type {
  DocumentAdapter,
  DocumentFormat,
  DocumentLocation,
  SelectionChapterContext,
  SelectedText,
  SourceSegment,
  StructuredSectionText,
  StructuredTextBlock,
  StructuredTextBlockKind,
} from './context/types';
export type { ContextPack, ContextScope, ContextSegment } from './context/contextPack';
export {
  deserializeSourceAnchor,
  parseSourceAnchor,
  serializeSourceAnchor,
  sourceAnchorSchema,
} from './citations/sourceAnchor';
export type { EpubSourceAnchorV1, SourceAnchor } from './citations/sourceAnchor';
export type {
  AnchorNavigationFailureReason,
  AnchorNavigationResult,
  AnchorNavigationSession,
  AnchorResolutionMethod,
  DocumentNavigator,
} from './citations/navigation';
export {
  GlossaRequestController,
  MockProvider,
  glossaAnswerSchema,
  glossaChapterSummarySchema,
  validateGlossaAnswer,
  validateGlossaChapterSummary,
} from './ai';
export type {
  AIProvider,
  AIProviderEvent,
  AIProviderRequest,
  GlossaAction,
  GlossaAnswer,
  GlossaAnswerValidation,
  GlossaChapterSummary,
  GlossaChapterSummaryValidation,
  ProviderError,
  ValidatedGlossaAnswer,
  ValidatedGlossaChapterSummary,
  ValidatedGlossaResult,
} from './ai';
export {
  GLOSSA_SOURCED_NOTE_VERSION,
  createGlossaSourcedNoteStore,
  glossaSourcedNoteSchema,
  readGlossaSourcedNotes,
} from './notes/glossaSourcedNotes';
export {
  GLOSSA_SOURCED_NOTES_EXPORT_VERSION,
  createGlossaSourcedNotesExport,
  glossaSourcedNotesExportSchema,
  serializeGlossaSourcedNotesJson,
  serializeGlossaSourcedNotesMarkdown,
} from './notes/glossaSourcedNotesExport';
export type {
  GlossaSourcedNote,
  GlossaSourcedNoteSaveResult,
  GlossaSourcedNoteStore,
} from './notes/glossaSourcedNotes';
export type { GlossaSourcedNotesExport } from './notes/glossaSourcedNotesExport';
