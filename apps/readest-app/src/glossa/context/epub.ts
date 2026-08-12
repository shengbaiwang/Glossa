import { isGlossaEnabled } from '../featureFlag';

export type EpubTextSegment = {
  sectionIndex: number;
  text: string;
};

export type EpubSelection = EpubTextSegment & {
  cfi?: string;
};

export type EpubLocation = {
  sectionIndex: number;
  sectionHref?: string;
  sectionLabel?: string;
  cfi: string;
  chapterProgress: { current: number; total: number };
  pageProgress: { current: number; total: number };
  bookProgress: number;
};

export type EpubReadingContext = {
  selection: EpubSelection | null;
  location: EpubLocation | null;
  visibleText: EpubTextSegment[];
  selectionParagraphs: EpubTextSegment[];
};

type EpubContent = {
  doc: Document;
  index?: number;
};

type EpubView = {
  renderer: { getContents: () => EpubContent[] };
  getCFI: (index: number, range: Range) => string;
  lastLocation?: unknown;
  addEventListener?: (type: string, listener: EventListener) => void;
  removeEventListener?: (type: string, listener: EventListener) => void;
};

/**
 * Readest/foliate runtime inputs. This is intentionally local to the EPUB
 * boundary: consumers receive only EpubReadingContext's plain data.
 */
export type EpubRuntime = {
  view: EpubView;
  progress: unknown;
};

export type EpubContextOptions = {
  adjacentParagraphs?: number;
};

type PageProgress = { current: number; total: number };

type ReaderProgress = {
  location: string;
  sectionHref?: string;
  sectionLabel?: string;
  section: PageProgress;
  pageinfo: PageProgress;
  fraction: number;
  index: number;
};

type ViewLocation = {
  cfi: string;
  range: Range;
  section?: PageProgress;
  location?: PageProgress;
  fraction?: number;
};

type Paragraph = EpubTextSegment & { element: Element };

const TEXT_NODE = 4;
const BLOCK_SELECTOR = 'p, li, blockquote, pre, h1, h2, h3, h4, h5, h6, td, th, figcaption';
const EXCLUDED_SELECTOR = 'script, style, template, nav, [hidden], [aria-hidden="true"]';

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;

const asPageProgress = (value: unknown): PageProgress | null => {
  const record = asRecord(value);
  const current = record?.['current'];
  const total = record?.['total'];
  return typeof current === 'number' &&
    Number.isFinite(current) &&
    typeof total === 'number' &&
    total > 0
    ? { current, total }
    : null;
};

const asReaderProgress = (value: unknown): ReaderProgress | null => {
  const record = asRecord(value);
  if (!record) return null;
  const location = record?.['location'];
  const section = asPageProgress(record?.['section']);
  const pageinfo = asPageProgress(record?.['pageinfo']);
  const fraction = record?.['fraction'];
  const index = record?.['index'];
  if (
    typeof location !== 'string' ||
    !section ||
    !pageinfo ||
    typeof fraction !== 'number' ||
    !Number.isFinite(fraction) ||
    typeof index !== 'number' ||
    !Number.isInteger(index)
  ) {
    return null;
  }
  const sectionHref = record['sectionHref'];
  const sectionLabel = record['sectionLabel'];
  return {
    location,
    section,
    pageinfo,
    fraction,
    index,
    ...(typeof sectionHref === 'string' ? { sectionHref } : {}),
    ...(typeof sectionLabel === 'string' ? { sectionLabel } : {}),
  };
};

const isRange = (value: unknown): value is Range => {
  const record = asRecord(value);
  return (
    !!record &&
    typeof record['cloneRange'] === 'function' &&
    typeof record['intersectsNode'] === 'function' &&
    'startContainer' in record
  );
};

const asViewLocation = (value: unknown): ViewLocation | null => {
  const record = asRecord(value);
  if (!record) return null;
  const cfi = record?.['cfi'];
  const range = record?.['range'];
  if (typeof cfi !== 'string' || !isRange(range)) return null;
  const section = asPageProgress(record['section']);
  const location = asPageProgress(record['location']);
  const fraction = record['fraction'];
  return {
    cfi,
    range,
    ...(section ? { section } : {}),
    ...(location ? { location } : {}),
    ...(typeof fraction === 'number' && Number.isFinite(fraction) ? { fraction } : {}),
  };
};

const getContents = (view: EpubView): EpubContent[] => {
  try {
    return view.renderer
      .getContents()
      .filter(
        (content): content is EpubContent =>
          !!content && content.doc?.nodeType === content.doc.DOCUMENT_NODE,
      );
  } catch {
    return [];
  }
};

const intersects = (range: Range, node: Node): boolean => {
  try {
    return range.intersectsNode(node);
  } catch {
    return false;
  }
};

const isExcludedTextNode = (node: Text): boolean => {
  let element = node.parentElement;
  while (element) {
    if (element.matches(EXCLUDED_SELECTOR)) return true;
    const style = element.getAttribute('style')?.toLowerCase() ?? '';
    if (/display\s*:\s*none|visibility\s*:\s*hidden/u.test(style)) return true;
    const computed = element.ownerDocument.defaultView?.getComputedStyle(element);
    if (computed?.display === 'none' || computed?.visibility === 'hidden') return true;
    element = element.parentElement;
  }
  return false;
};

const textNodesInRange = (range: Range): Text[] => {
  const document = range.startContainer.ownerDocument;
  if (!document) return [];
  const root = range.commonAncestorContainer;
  const nodes: Text[] = [];
  if (root.nodeType === root.TEXT_NODE) {
    nodes.push(root as Text);
  } else {
    const walker = document.createTreeWalker(root, TEXT_NODE);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (intersects(range, node)) nodes.push(node as Text);
    }
  }
  return nodes.filter((node) => !isExcludedTextNode(node));
};

const textFromRange = (range: Range): string => {
  const parts = textNodesInRange(range).map((node) => {
    const start = node === range.startContainer ? range.startOffset : 0;
    const end = node === range.endContainer ? range.endOffset : node.data.length;
    return node.data.slice(start, end);
  });
  return parts.join('').trim();
};

const paragraphsForDocument = (doc: Document, sectionIndex: number): Paragraph[] => {
  const paragraphs: Paragraph[] = [];
  for (const element of doc.querySelectorAll(BLOCK_SELECTOR)) {
    if (element.matches(EXCLUDED_SELECTOR)) continue;
    const range = doc.createRange();
    range.selectNodeContents(element);
    const text = textFromRange(range);
    if (text) paragraphs.push({ sectionIndex, text, element });
  }
  return paragraphs;
};

const textFromRangeIntersection = (range: Range, element: Element): string => {
  const doc = element.ownerDocument;
  const elementRange = doc.createRange();
  elementRange.selectNodeContents(element);
  if (!intersects(range, element)) return '';
  const intersection = doc.createRange();
  const startsInsideElement = range.compareBoundaryPoints(Range.START_TO_START, elementRange) > 0;
  const endsInsideElement = range.compareBoundaryPoints(Range.END_TO_END, elementRange) < 0;
  intersection.setStart(
    startsInsideElement ? range.startContainer : elementRange.startContainer,
    startsInsideElement ? range.startOffset : elementRange.startOffset,
  );
  intersection.setEnd(
    endsInsideElement ? range.endContainer : elementRange.endContainer,
    endsInsideElement ? range.endOffset : elementRange.endOffset,
  );
  return textFromRange(intersection);
};

const findContentForDocument = (contents: EpubContent[], doc: Document): EpubContent | null =>
  contents.find((content) => content.doc === doc) ?? null;

const getSelection = (
  view: EpubView,
  fallbackIndex: number | null,
): { data: EpubSelection; range: Range } | null => {
  const contents = getContents(view);
  for (const content of contents) {
    const selection = content.doc.getSelection();
    if (!selection || selection.rangeCount === 0) continue;
    const range = selection.getRangeAt(0);
    const text = textFromRange(range);
    if (!text) continue;
    const sectionIndex = typeof content.index === 'number' ? content.index : fallbackIndex;
    if (sectionIndex === null || sectionIndex < 0) return null;
    let cfi: string | undefined;
    try {
      cfi = view.getCFI(sectionIndex, range);
    } catch {
      cfi = undefined;
    }
    return { data: { sectionIndex, text, ...(cfi ? { cfi } : {}) }, range };
  }
  return null;
};

const getSelectionParagraphs = (
  range: Range,
  sectionIndex: number,
  adjacentParagraphs: number,
): EpubTextSegment[] => {
  const doc = range.startContainer.ownerDocument;
  if (!doc) return [];
  const paragraphs = paragraphsForDocument(doc, sectionIndex);
  const selected = paragraphs
    .map((paragraph, index) => (intersects(range, paragraph.element) ? index : -1))
    .filter((index) => index >= 0);
  if (selected.length === 0) return [];
  const first = selected[0]!;
  const last = selected[selected.length - 1]!;
  const before = Math.max(0, first - adjacentParagraphs);
  const after = Math.min(paragraphs.length, last + adjacentParagraphs + 1);
  return paragraphs
    .slice(before, after)
    .map(({ sectionIndex: index, text }) => ({ sectionIndex: index, text }));
};

const getVisibleText = (view: EpubView): EpubTextSegment[] => {
  const location = asViewLocation(view.lastLocation);
  if (!location) return [];
  const doc = location.range.startContainer.ownerDocument;
  if (!doc) return [];
  const content = findContentForDocument(getContents(view), doc);
  const sectionIndex = content?.index;
  if (typeof sectionIndex !== 'number' || sectionIndex < 0) return [];
  return paragraphsForDocument(doc, sectionIndex)
    .map((paragraph) => ({
      sectionIndex,
      text: textFromRangeIntersection(location.range, paragraph.element),
    }))
    .filter((segment) => !!segment.text);
};

const getLocation = (runtime: EpubRuntime): EpubLocation | null => {
  const progress = asReaderProgress(runtime.progress);
  if (!progress) return null;
  return {
    sectionIndex: progress.index,
    ...(progress.sectionHref ? { sectionHref: progress.sectionHref } : {}),
    ...(progress.sectionLabel ? { sectionLabel: progress.sectionLabel } : {}),
    cfi: progress.location,
    chapterProgress: progress.section,
    pageProgress: progress.pageinfo,
    bookProgress: progress.fraction,
  };
};

/**
 * Reads only the chapter documents foliate has already loaded. `lastLocation`
 * is foliate's current relocate snapshot, whose range is the visible range.
 */
export const getEpubReadingContext = (
  runtime: EpubRuntime,
  options: EpubContextOptions = {},
): EpubReadingContext => {
  const location = getLocation(runtime);
  const selection = getSelection(runtime.view, location?.sectionIndex ?? null);
  const adjacentParagraphs = Math.max(0, Math.min(options.adjacentParagraphs ?? 2, 4));
  return {
    selection: selection?.data ?? null,
    location,
    visibleText: getVisibleText(runtime.view),
    selectionParagraphs: selection
      ? getSelectionParagraphs(selection.range, selection.data.sectionIndex, adjacentParagraphs)
      : [],
  };
};

/**
 * Subscribes to native selectionchange in currently loaded EPUB iframes.
 * The Glossa feature switch is checked before listeners are installed, so the
 * default-disabled reader never receives an extra iframe or foliate listener.
 */
export const subscribeToEpubSelection = (
  runtime: EpubRuntime,
  listener: (selection: EpubSelection | null) => void,
): (() => void) => {
  if (!isGlossaEnabled()) return () => {};

  const attachedDocuments = new Map<Document, EventListener>();
  const fallbackIndex = () => getLocation(runtime)?.sectionIndex ?? null;
  const notify = () => listener(getSelection(runtime.view, fallbackIndex())?.data ?? null);
  const attach = (doc: Document) => {
    if (attachedDocuments.has(doc)) return;
    const onSelectionChange: EventListener = () => notify();
    doc.addEventListener('selectionchange', onSelectionChange);
    attachedDocuments.set(doc, onSelectionChange);
  };
  const attachLoadedDocuments = () => {
    for (const { doc } of getContents(runtime.view)) attach(doc);
  };
  const onLoad: EventListener = (event) => {
    const detail = asRecord((event as CustomEvent<unknown>).detail);
    const doc = detail?.['doc'];
    if (asRecord(doc)?.['nodeType'] === 9) attach(doc as Document);
  };

  attachLoadedDocuments();
  runtime.view.addEventListener?.('load', onLoad);
  return () => {
    for (const [doc, onSelectionChange] of attachedDocuments) {
      doc.removeEventListener('selectionchange', onSelectionChange);
    }
    runtime.view.removeEventListener?.('load', onLoad);
  };
};
