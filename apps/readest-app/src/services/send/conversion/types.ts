import type { BookWebSource } from '@/types/book';

/** MIME types that Send to Readest converts to EPUB before import. */
export type ConvertibleMime =
  | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' // .docx
  | 'application/rtf'
  | 'text/rtf'
  | 'text/html'
  | 'application/xhtml+xml'
  | 'text/plain'
  | 'text/uri-list'; // a web article URL

export interface ConvertedBook {
  /** The generated `.epub` file, ready for the normal import pipeline. */
  file: File;
  title: string;
  author: string;
  source?: WebArticleSource;
  /** Original PDF bytes retain their web origin alongside the library record. */
  webSource?: BookWebSource;
  warnings?: ConversionWarning[];
}

export interface ConversionWarning {
  code: 'missing_assets' | 'partial_content';
  count?: number;
}

/** Provenance of captured content, never an identity or deduplication key. */
export interface WebArticleSource {
  originalUrl: string;
  url: string;
  canonicalUrl?: string;
  /** Publisher-declared full text; never fetched implicitly. */
  pdfUrl?: string;
  site?: string;
  published?: string;
  extractor: string;
  version: string;
  scope: 'article' | 'excerpt' | 'abstract';
  captureMethod?: WebCaptureMethod;
  missingAssets?: string[];
}

export type WebCaptureMethod = 'http' | 'webview' | 'selection' | 'browser' | 'shared';

export interface WebArticleOptions {
  originalUrl?: string;
  baseUrl?: string;
  scope?: WebArticleSource['scope'];
  captureMethod?: WebCaptureMethod;
  /** Page conversion runs on the main thread; never serialize this callback. */
  onStage?: (stage: string) => void;
}

/** One chapter of body-inner HTML (already sanitized). */
export interface EpubChapter {
  title: string;
  html: string;
}

/** An image resource embedded directly in the EPUB. Path is relative to
 *  `OEBPS/` and must match the rewritten `<img src>` in the chapter HTML. */
export interface EpubImage {
  path: string;
  bytes: ArrayBuffer;
  mime: string;
}

export interface EpubBuildMetadata {
  title: string;
  author: string;
  language: string;
  /** Stable EPUB `dc:identifier` — derive deterministically so re-converting
   *  the same source yields the same bytes and dedups on import. */
  identifier: string;
  /** Optional in-chapter heading TOC. When present, `toc.ncx` `navMap`
   *  uses these instead of a single chapter-level navPoint — the EPUB
   *  reader's sidebar then shows the article's section structure. */
  toc?: TocEntry[];
  source?: WebArticleSource;
  warnings?: ConversionWarning[];
}

/** One entry in the EPUB's nested TOC — a single `<h1>`–`<h6>` from the
 *  article. `level` is 1–6; `chapterIndex` is 0 for now (page clips are
 *  single-chapter). */
export interface TocEntry {
  id: string;
  text: string;
  level: number;
  chapterIndex?: number;
}

export class ConversionError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'unsupported_type'
      | 'empty_input'
      | 'parse_failed'
      | 'fetch_failed'
      | 'login_wall',
  ) {
    super(message);
    this.name = 'ConversionError';
  }
}
