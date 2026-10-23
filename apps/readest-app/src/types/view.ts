import { BookDoc, TOCItem } from '@/libs/document';
import { BookNote, BookSearchConfig, BookSearchResult } from '@/types/book';
import { TTSGranularity } from '@/services/tts/types';
import { TTS } from 'foliate-js/tts.js';

import { LocaleWithTextInfo } from './misc';

// The mark source driving Read Aloud: foliate's text segmentation for
// synthesized speech, or the book's own Media Overlay pars when playing its
// recorded narration. Both expose the same navigation surface.
export type ViewTTS = TTS;

export const NOTE_PREFIX = 'foliate-note:';

type RangeAnchor = (doc: Document) => Range;

export interface PDFSelectionFragment {
  index: number;
  range: Range;
  focus?: boolean;
}

export interface Renderer extends HTMLElement {
  scrolled?: boolean;
  scrollLocked: boolean;
  size: number; // current page height
  viewSize: number; // whole document view height
  start: number;
  end: number;
  page: number; // section page index (0-based)
  pages: number; // section page count
  atStart: boolean;
  atEnd: boolean;
  containerPosition: number;
  scrollProp: 'scrollLeft' | 'scrollTop';
  sideProp: 'width' | 'height';
  pageColors?: {
    background: string;
    foreground: string;
  };
  columnCount?: number;
  open: (book: BookDoc) => Promise<void>;
  setAttribute: (name: string, value: string | number) => void;
  removeAttribute: (name: string) => void;
  next: () => Promise<void>;
  prev: () => Promise<void>;
  nextSection?: () => Promise<void>;
  prevSection?: () => Promise<void>;
  render?: () => Promise<void>;
  goTo: (params: { index: number; anchor?: number | RangeAnchor }) => Promise<void>;
  setStyles?: (css: string) => void;
  primaryIndex: number;
  /** Fixed-layout renderers expose the visible PDF page through index. */
  readonly index?: number;
  /** Actual CSS scale relative to the PDF page's intrinsic viewport. */
  readonly scale?: number;
  getContents: () => { doc: Document; index?: number; overlayer?: unknown }[];
  scrollToAnchor?: (anchor: number | Range, reason?: string, smooth?: boolean) => void;
  scrollToPageRect?: (
    index: number,
    rect: { x: number; y: number; width: number; height: number },
    viewport?: { x: number; y: number; width: number; height: number },
  ) => void;
  addEventListener: (
    type: string,
    listener: EventListener,
    option?: AddEventListenerOptions,
  ) => void;
  removeEventListener: (type: string, listener: EventListener) => void;
  showLoupe?: (
    x: number,
    y: number,
    options: {
      isVertical: boolean;
      color: string;
      gap: number;
      margin: number;
      radius: number;
      magnification: number;
    },
  ) => void;
  hideLoupe?: () => void;
  destroyLoupe?: () => void;
  pinchZoom?: (ratio: number) => void;
  pinchEnd?: () => void;
  destroy: () => void;
}

export interface FoliateView extends HTMLElement {
  open: (book: BookDoc) => Promise<void>;
  close: () => void;
  init: (options: { lastLocation: string }) => void;
  goTo: (target: string | number) => void;
  goToFraction: (fraction: number) => void;
  getSectionFractions: () => number[];
  prev: (distance?: number) => void;
  next: (distance?: number) => void;
  pan: (dx: number, dy: number) => void;
  isOverflowX: () => boolean;
  isOverflowY: () => boolean;
  goLeft: () => void;
  goRight: () => void;
  getCFI: (index: number, range: Range) => string;
  getPDFSelection?: () => PDFSelectionFragment[] | null;
  startPDFSelectionHandle?: (cfis: string[], side: 'start' | 'end') => Promise<boolean>;
  extendPDFSelectionHandle?: (
    direction: 'left' | 'right' | 'forward' | 'backward',
  ) => Promise<boolean>;
  movePDFSelectionHandle?: (point: { x: number; y: number }) => void;
  stopPDFSelectionHandle?: () => void;
  getCFIProgress: (cfi: string) => Promise<{
    fraction: number;
    section: { current: number; total: number };
    location: { current: number; next: number; total: number };
    time: { section: number; total: number };
  } | null>;
  resolveCFI: (cfi: string) => { index: number; anchor: RangeAnchor };
  resolveNavigation: (cfiOrHrefOrIndex: string | number) => { index: number; anchor?: RangeAnchor };
  addAnnotation: (
    note: BookNote & { value?: string },
    remove?: boolean,
  ) => { index: number; label: string };
  search: (config: BookSearchConfig) => AsyncGenerator<BookSearchResult | string, void, void>;
  clearSearch: () => void;
  setSearchMatchActive: (cfi: string | null) => Promise<void>;
  updateTOC?: (toc: TOCItem[], signal?: AbortSignal) => Promise<void>;
  select: (target: string | number | { fraction: number }) => void;
  deselect: () => void;
  initTTS: (
    granularity?: TTSGranularity,
    nodeFilter?: (node: Node) => number,
    highlight?: (range: Range) => void,
  ) => Promise<void>;
  book: BookDoc;
  tts: ViewTTS | null;
  // The most recent relocate location, set synchronously by foliate on every
  // relocate — fresher than the rAF-debounced readerStore progress.
  lastLocation?: { cfi?: string; range?: Range | null; tocItem?: TOCItem | null };
  isFixedLayout: boolean;
  language: {
    locale?: LocaleWithTextInfo;
    isCJK?: boolean;
    canonical?: string;
    direction?: string;
  };
  history: {
    canGoBack: boolean;
    canGoForward: boolean;
    back: () => void;
    forward: () => void;
    clear: () => void;
  };
  renderer: Renderer;
}

export const wrappedFoliateView = (originalView: FoliateView): FoliateView => {
  const originalAddAnnotation = originalView.addAnnotation.bind(originalView);
  originalView.addAnnotation = (note: BookNote, remove = false) => {
    // transform BookNote to foliate annotation
    const annotation = {
      value: note.cfi,
      ...note,
    };
    return originalAddAnnotation(annotation, remove);
  };

  const originalGoTo = originalView.goTo.bind(originalView);
  // The FoliateView interface declares goTo as (href: string) => void, but
  // Foliate's runtime implementation returns a Promise. Returning a Promise
  // here is compatible with the void return type in TypeScript and lets callers
  // that know about the promise (e.g. tests, async handlers) await completion.
  originalView.goTo = (target: string | number): Promise<void> => {
    // Cross-section jumps can take seconds (the target section's images block
    // its iframe load); surface start/end so the viewer can show a spinner.
    originalView.dispatchEvent(new CustomEvent('navigate-start'));
    return Promise.resolve(originalGoTo(target)).finally(() => {
      originalView.dispatchEvent(new CustomEvent('navigate-end'));
    });
  };

  return originalView;
};
