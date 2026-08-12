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

/** Plain EPUB boundary data used by the adapter to construct SourceAnchor V1. */
export type EpubAnchorTextSegment = EpubTextSegment & {
  cfi?: string;
  quote: {
    exact: string;
    prefix?: string;
    suffix?: string;
  };
  isSelectionParagraph?: boolean;
};

export type EpubAnchorReadingContext = {
  selection: EpubAnchorTextSegment | null;
  location: EpubLocation | null;
  visibleText: EpubAnchorTextSegment[];
  selectionParagraphs: EpubAnchorTextSegment[];
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

/** Shared trustworthy-text rule for EPUB context extraction and anchor recovery. */
export const isEpubReadableTextNode = (node: Text): boolean => !isExcludedTextNode(node);

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

/** Read a real EPUB Range with the same hidden/untrusted-node filtering as B01–B05. */
export const textFromEpubRange = (range: Range): string => textFromRange(range);

const truncateUnicode = (text: string, maximum: number, fromEnd = false): string => {
  const characters = Array.from(text);
  return (fromEnd ? characters.slice(-maximum) : characters.slice(0, maximum)).join('');
};

const quoteForRange = (
  range: Range,
  exact: string,
): { exact: string; prefix?: string; suffix?: string } => {
  const doc = range.startContainer.ownerDocument;
  if (!doc?.body) return { exact };

  const allTextNodes: Text[] = [];
  const walker = doc.createTreeWalker(doc.body, TEXT_NODE);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (!isExcludedTextNode(node as Text)) allTextNodes.push(node as Text);
  }

  let documentText = '';
  let selectedText = '';
  let selectedStart: number | null = null;
  let selectedEnd: number | null = null;
  for (const textNode of allTextNodes) {
    const nodeStart = documentText.length;
    const nodeRange = doc.createRange();
    nodeRange.selectNodeContents(textNode);
    if (intersects(range, textNode)) {
      const startsInsideNode = range.compareBoundaryPoints(Range.START_TO_START, nodeRange) > 0;
      const endsInsideNode = range.compareBoundaryPoints(Range.END_TO_END, nodeRange) < 0;
      const start = startsInsideNode ? range.startOffset : 0;
      const end = endsInsideNode ? range.endOffset : textNode.data.length;
      if (end > start) {
        if (selectedStart === null) selectedStart = nodeStart + start;
        selectedEnd = nodeStart + end;
        selectedText += textNode.data.slice(start, end);
      }
    }
    documentText += textNode.data;
  }

  const normalizedSelection = selectedText.trim();
  if (selectedStart === null || selectedEnd === null || normalizedSelection !== exact) {
    return { exact };
  }
  const leadingWhitespace = selectedText.length - selectedText.trimStart().length;
  const trailingWhitespace = selectedText.length - selectedText.trimEnd().length;
  const start = selectedStart + leadingWhitespace;
  const end = selectedEnd - trailingWhitespace;
  const prefix = truncateUnicode(documentText.slice(0, start), 48, true);
  const suffix = truncateUnicode(documentText.slice(end), 48);
  return {
    exact,
    ...(prefix ? { prefix } : {}),
    ...(suffix ? { suffix } : {}),
  };
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
  const intersection = rangeIntersection(range, element);
  return intersection ? textFromRange(intersection) : '';
};

const rangeIntersection = (range: Range, element: Element): Range | null => {
  const doc = element.ownerDocument;
  const elementRange = doc.createRange();
  elementRange.selectNodeContents(element);
  if (!intersects(range, element)) return null;
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
  return intersection;
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

const getCfi = (view: EpubView, sectionIndex: number, range: Range): string | undefined => {
  try {
    return view.getCFI(sectionIndex, range) || undefined;
  } catch {
    return undefined;
  }
};

const anchorSegment = (
  view: EpubView,
  sectionIndex: number,
  range: Range,
  text: string,
  isSelectionParagraph = false,
): EpubAnchorTextSegment => {
  const cfi = getCfi(view, sectionIndex, range);
  return {
    sectionIndex,
    text,
    ...(cfi ? { cfi } : {}),
    quote: quoteForRange(range, text),
    ...(isSelectionParagraph ? { isSelectionParagraph: true } : {}),
  };
};

const getAnchorVisibleText = (view: EpubView): EpubAnchorTextSegment[] => {
  const location = asViewLocation(view.lastLocation);
  if (!location) return [];
  const doc = location.range.startContainer.ownerDocument;
  if (!doc) return [];
  const content = findContentForDocument(getContents(view), doc);
  const sectionIndex = content?.index;
  if (typeof sectionIndex !== 'number' || sectionIndex < 0) return [];
  return paragraphsForDocument(doc, sectionIndex).flatMap((paragraph) => {
    const range = rangeIntersection(location.range, paragraph.element);
    const text = range ? textFromRange(range) : '';
    return range && text ? [anchorSegment(view, sectionIndex, range, text)] : [];
  });
};

const getAnchorSelectionParagraphs = (
  view: EpubView,
  range: Range,
  sectionIndex: number,
  adjacentParagraphs: number,
): EpubAnchorTextSegment[] => {
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
  return paragraphs.slice(before, after).flatMap((paragraph, index) => {
    const paragraphRange = doc.createRange();
    paragraphRange.selectNodeContents(paragraph.element);
    const text = textFromRange(paragraphRange);
    return text
      ? [
          anchorSegment(
            view,
            sectionIndex,
            paragraphRange,
            text,
            index + before >= first && index + before <= last,
          ),
        ]
      : [];
  });
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
 * Adapter-only counterpart of getEpubReadingContext. It performs the same
 * bounded extraction but retains no DOM values after calculating CFI and
 * TextQuote data, so callers can safely turn every segment into JSON.
 */
export const getEpubAnchorReadingContext = (
  runtime: EpubRuntime,
  options: EpubContextOptions = {},
): EpubAnchorReadingContext => {
  const location = getLocation(runtime);
  const selection = getSelection(runtime.view, location?.sectionIndex ?? null);
  const adjacentParagraphs = Math.max(0, Math.min(options.adjacentParagraphs ?? 2, 4));
  return {
    selection: selection
      ? anchorSegment(
          runtime.view,
          selection.data.sectionIndex,
          selection.range,
          selection.data.text,
        )
      : null,
    location,
    visibleText: getAnchorVisibleText(runtime.view),
    selectionParagraphs: selection
      ? getAnchorSelectionParagraphs(
          runtime.view,
          selection.range,
          selection.data.sectionIndex,
          adjacentParagraphs,
        )
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
