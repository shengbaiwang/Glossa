/**
 * Public entry point for Glossa's reader-assistance module.
 *
 * The first EPUB vertical slice uses only the bounded `context`, `ai`, `ui`,
 * and `citations` contracts below. Retrieval, notes, real providers, and
 * persistence deliberately remain outside this public surface.
 */
export { isGlossaEnabled } from './featureFlag';
export { createEpubDocumentAdapter } from './context/epubAdapter';
export {
  createChapterToSelectionContextPack,
  createContextPack,
  MAX_CHAPTER_CONTEXT_CHARACTERS,
  MAX_CHAPTER_CONTEXT_SEGMENTS,
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
  validateGlossaAnswer,
} from './ai';
export type {
  AIProvider,
  AIProviderEvent,
  AIProviderRequest,
  GlossaAction,
  GlossaAnswer,
  GlossaAnswerValidation,
  ProviderError,
  ValidatedGlossaAnswer,
} from './ai';
