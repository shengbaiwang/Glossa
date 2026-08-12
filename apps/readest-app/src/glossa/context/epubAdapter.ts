import type { SourceAnchor } from '../citations/sourceAnchor';
import {
  getEpubAnchorReadingContext,
  getEpubReadingContext,
  type EpubAnchorTextSegment,
  type EpubRuntime,
} from './epub';
import type { DocumentAdapter, DocumentLocation, SourceSegment } from './types';

const sectionIdFor = (
  segment: EpubAnchorTextSegment,
  location: { sectionIndex: number; sectionHref?: string } | null,
): string =>
  location?.sectionIndex === segment.sectionIndex && location.sectionHref
    ? location.sectionHref
    : `spine:${segment.sectionIndex}`;

const toSourceSegment = (
  documentId: string,
  segment: EpubAnchorTextSegment,
  location: { sectionIndex: number; sectionHref?: string } | null,
): SourceSegment => {
  const anchor: SourceAnchor = {
    version: 1,
    documentId,
    format: 'epub',
    sectionId: sectionIdFor(segment, location),
    ...(segment.cfi ? { cfi: segment.cfi } : {}),
    quote: segment.quote,
  };
  return { text: segment.text, anchor };
};

export function createEpubDocumentAdapter(options: {
  documentId: string;
  getRuntime: () => EpubRuntime | null;
}): DocumentAdapter {
  const { documentId, getRuntime } = options;
  if (!documentId.trim()) throw new Error('EpubDocumentAdapter requires a non-empty documentId');

  const read = (adjacentParagraphs?: number) => {
    const runtime = getRuntime();
    if (!runtime) return null;
    // Keep B01–B03's public context reader on the adapter path. Anchor data is
    // computed by its bounded EPUB counterpart and never exposes DOM objects.
    getEpubReadingContext(runtime, { adjacentParagraphs });
    return getEpubAnchorReadingContext(runtime, { adjacentParagraphs });
  };

  return {
    documentId,
    format: 'epub',
    async getSelection() {
      const context = read();
      return context?.selection
        ? toSourceSegment(documentId, context.selection, context.location)
        : null;
    },
    async getCurrentLocation(): Promise<DocumentLocation | null> {
      const context = read();
      const location = context?.location;
      if (!location) return null;
      return {
        documentId,
        format: 'epub',
        sectionId: location.sectionHref ?? `spine:${location.sectionIndex}`,
        sectionIndex: location.sectionIndex,
        ...(location.cfi
          ? { nativeLocation: { kind: 'epub-cfi' as const, value: location.cfi } }
          : {}),
        progress: location.bookProgress,
      };
    },
    async getVisibleText() {
      const context = read();
      return context
        ? context.visibleText.map((segment) =>
            toSourceSegment(documentId, segment, context.location),
          )
        : [];
    },
    async getSelectionContext({ adjacentParagraphs } = {}) {
      const context = read(adjacentParagraphs);
      if (!context?.selection) return [];
      const selected = toSourceSegment(documentId, context.selection, context.location);
      const paragraphs = context.selectionParagraphs;
      const firstSelectedIndex = paragraphs.findIndex(
        (paragraph) => paragraph.isSelectionParagraph,
      );
      if (firstSelectedIndex < 0) return [selected];
      return [
        ...paragraphs
          .slice(0, firstSelectedIndex)
          .map((paragraph) => toSourceSegment(documentId, paragraph, context.location)),
        selected,
        ...paragraphs
          .slice(
            firstSelectedIndex +
              paragraphs.filter((paragraph) => paragraph.isSelectionParagraph).length,
          )
          .map((paragraph) => toSourceSegment(documentId, paragraph, context.location)),
      ];
    },
  };
}
