/**
 * Public entry point for Glossa's reader-assistance module.
 *
 * Future implementation belongs beneath this root: `ui`, `context`,
 * `retrieval`, `ai`, `citations`, and `notes`. They are deliberately not
 * created until they have real callers, so the scaffold has no product UI or
 * model behavior yet.
 */
export { isGlossaEnabled } from './featureFlag';
export { createEpubDocumentAdapter } from './context/epubAdapter';
export type {
  DocumentAdapter,
  DocumentFormat,
  DocumentLocation,
  SelectedText,
  SourceSegment,
} from './context/types';
export {
  deserializeSourceAnchor,
  parseSourceAnchor,
  serializeSourceAnchor,
  sourceAnchorSchema,
} from './citations/sourceAnchor';
export type { EpubSourceAnchorV1, SourceAnchor } from './citations/sourceAnchor';
