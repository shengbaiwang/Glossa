import type { SourceAnchor } from '../citations/sourceAnchor';

/** Format-neutral, JSON-safe contract consumed by future Glossa AI code. */
export type DocumentFormat = 'epub' | 'pdf' | 'web';

export type DocumentLocation = {
  documentId: string;
  format: DocumentFormat;
  sectionId?: string;
  sectionIndex?: number;
  nativeLocation?: {
    kind: 'epub-cfi';
    value: string;
  };
  progress?: number;
};

export type SourceSegment = {
  text: string;
  anchor: SourceAnchor;
};

export type SelectedText = SourceSegment;

/**
 * A cleaned, format-neutral chapter snapshot. It intentionally contains no
 * DOM, foliate, PDF.js, or reader state and is safe to retain in an open panel.
 */
export type StructuredTextBlockKind =
  | 'heading'
  | 'paragraph'
  | 'list-item'
  | 'quote'
  | 'code'
  | 'table'
  | 'caption';

export type StructuredTextBlock = SourceSegment & {
  kind: StructuredTextBlockKind;
  /** Stable within one section snapshot; never used as a source identity. */
  order: number;
};

export type StructuredSectionText = {
  documentId: string;
  format: DocumentFormat;
  sectionId: string;
  sectionIndex?: number;
  sectionLabel?: string;
  blocks: StructuredTextBlock[];
};

/** A selection-time, spoiler-safe subset of the current structured section. */
export type SelectionChapterContext = {
  section: Omit<StructuredSectionText, 'blocks'> & { blocks: StructuredTextBlock[] };
};

export interface DocumentAdapter {
  readonly documentId: string;
  readonly format: DocumentFormat;

  getSelection(): Promise<SelectedText | null>;
  getCurrentLocation(): Promise<DocumentLocation | null>;
  getVisibleText(): Promise<SourceSegment[]>;
  getSelectionContext(options?: { adjacentParagraphs?: number }): Promise<SourceSegment[]>;
  getCurrentSectionText(): Promise<StructuredSectionText | null>;
  /**
   * Snapshot only blocks provably before the live selection. Call this before
   * the reader clears its native Selection; it never uses reading progress.
   */
  getSelectionChapterContext(): Promise<SelectionChapterContext | null>;
}
