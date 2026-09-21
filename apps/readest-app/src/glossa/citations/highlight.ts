import type { FoliateView } from '@/types/view';
import type { ResolvedSource } from './sources';
import { normalizeSourceText, readRangeText } from '../context/text';

/** A disposable paint layer: no native selection, annotation record or text-node changes. */
export function highlightSource(view: FoliateView, source: ResolvedSource): () => void {
  const noop = () => {};
  try {
    const { index, anchor } = view.resolveCFI(source.cfi);
    const doc = view.renderer.getContents().find((content) => content.index === index)?.doc;
    const win = doc?.defaultView as (Window & typeof globalThis) | null;
    if (!doc || !win?.CSS?.highlights || !win.Highlight) return noop;
    const range = anchor(doc);
    // Reflow/transforms may differ from the original document used by the verifier.
    if (range.collapsed || readRangeText(doc, range) !== normalizeSourceText(source.text))
      return noop;
    const highlight = new win.Highlight(range);
    const style = doc.createElement('style');
    style.textContent = `::highlight(glossa-source) {
      color: var(--theme-fg-color, CanvasText);
      background-color: color-mix(in srgb, var(--theme-fg-color, CanvasText) 18%, var(--theme-bg-color, Canvas));
      text-decoration: underline;
      text-decoration-color: var(--theme-fg-color, CanvasText);
    }`;
    doc.head.append(style);
    win.CSS.highlights.set('glossa-source', highlight);
    const clear = () => {
      if (win.CSS.highlights.get('glossa-source') === highlight)
        win.CSS.highlights.delete('glossa-source');
      style.remove();
      view.removeEventListener('relocate', clear);
    };
    // Ordinary reading resumes as soon as the reader moves away.
    view.addEventListener('relocate', clear, { once: true });
    return clear;
  } catch {
    // Older WebViews can still show the verified passage in the source panel.
    return noop;
  }
}
