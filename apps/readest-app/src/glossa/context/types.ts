export interface ChapterBoundary {
  sectionIndex: number;
  fragment?: string;
}

export interface ChapterDescriptor {
  id: string;
  title: string;
  href: string;
  depth: number;
  parentId?: string;
  sectionIndex: number;
  start: ChapterBoundary;
  end?: ChapterBoundary;
}

export interface SourceAnchor {
  sectionIndex: number;
  cfi: string;
  quote: { exact: string; prefix: string; suffix: string };
}

export interface ChapterSource {
  sourceId: string;
  text: string;
  kind: 'heading' | 'paragraph' | 'list' | 'table' | 'quote';
  anchor: SourceAnchor;
}

export interface ChapterContent {
  chapter: ChapterDescriptor;
  sources: ChapterSource[];
  characterCount: number;
}
