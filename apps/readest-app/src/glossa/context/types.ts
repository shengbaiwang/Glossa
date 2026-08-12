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

export interface DocumentAdapter {
  readonly documentId: string;
  readonly format: DocumentFormat;

  getSelection(): Promise<SelectedText | null>;
  getCurrentLocation(): Promise<DocumentLocation | null>;
  getVisibleText(): Promise<SourceSegment[]>;
  getSelectionContext(options?: { adjacentParagraphs?: number }): Promise<SourceSegment[]>;
}
