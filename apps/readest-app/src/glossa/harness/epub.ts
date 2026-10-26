// Preserve existing EPUB integrations while Markdown shares the same inert DOM/CFI access.
export {
  createReflowableBookAccess as createEpubBookAccess,
  createReflowableFocusReader as createEpubFocusReader,
  captureReadingScope,
  prepareChapterPassages,
  scopeForPassage,
  type ReadingCaptureView,
} from './reflowable';
