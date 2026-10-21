import { useEffect, useRef, useState } from 'react';
import type { BookNote, HighlightColor } from '@/types/book';
import type { Point, TextSelection } from '@/utils/sel';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useThemeStore } from '@/store/themeStore';
import { useTranslation } from '@/hooks/useTranslation';
import { eventDispatcher } from '@/utils/event';
import { useAnnotationEditor } from '../../hooks/useAnnotationEditor';
import { getHandlePositionsFromRange, getHighlightColorHex } from '../../utils/annotatorUtil';
import { Handle } from './AnnotationRangeEditor';
import MagnifierLoupe from './MagnifierLoupe';

type Side = 'start' | 'end';
interface Props {
  bookKey: string;
  annotation?: BookNote;
  selection: TextSelection;
  handleColor: HighlightColor;
  getAnnotationText: (range: Range) => Promise<string>;
  setSelection: React.Dispatch<React.SetStateAction<TextSelection | null>>;
  onStartEdit: () => void;
}

// The handles stay in the reading surface. The PDF coordinator owns all page
// ranges, hit testing and edge scrolling; only pointer release writes a note.
export default function PDFRangeEditor(props: Props) {
  const { bookKey, annotation, selection, handleColor, onStartEdit } = props;
  const _ = useTranslation();
  const { getView } = useReaderStore();
  const view = getView(bookKey);
  const { settings } = useSettingsStore();
  const { isDarkMode } = useThemeStore();
  const { applyPDFAnnotationRanges } = useAnnotationEditor(props);
  const [positions, setPositions] = useState<Partial<Record<Side, Point & { vertical: boolean }>>>(
    {},
  );
  const [side, setSide] = useState<Side | null>(null);
  const [loupe, setLoupe] = useState<Point | null>(null);
  const touch = useRef(false);
  const revision = useRef(0);
  const drag = useRef<{ ready: Promise<boolean>; point?: Point; revision: number } | null>(null);
  const keyBusy = useRef(false);
  const cfis = selection.pdfRanges ?? (selection.cfi ? [selection.cfi] : []);
  const current = useRef({ selection, cfis, applyPDFAnnotationRanges });
  current.current = { selection, cfis, applyPDFAnnotationRanges };

  useEffect(() => {
    if (!view) return;
    const update = () => {
      const fragments = drag.current ? view.getPDFSelection?.() : null;
      const next: Partial<Record<Side, Point & { vertical: boolean }>> = {};
      for (const endpoint of ['start', 'end'] as const) {
        try {
          let range = (endpoint === 'start' ? fragments?.[0] : fragments?.at(-1))?.range;
          if (!fragments) {
            const cfis = current.current.cfis;
            const cfi = endpoint === 'start' ? cfis[0] : cfis.at(-1);
            if (!cfi) continue;
            const resolved = view.resolveCFI(cfi);
            const doc = view.renderer.getContents().find((c) => c.index === resolved.index)?.doc;
            if (!doc) continue;
            range = resolved.anchor(doc) as Range;
          }
          if (!range) continue;
          const frame = range.startContainer.ownerDocument?.defaultView?.frameElement;
          if (!frame || getComputedStyle(frame.parentElement!).visibility === 'hidden') continue;
          const node = endpoint === 'start' ? range.startContainer : range.endContainer;
          const element =
            node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
          if (!element) continue;
          const style = element.ownerDocument.defaultView!.getComputedStyle(element);
          const vertical = style.writingMode.startsWith('vertical');
          const position = getHandlePositionsFromRange(bookKey, range, vertical)?.[endpoint];
          if (position && !vertical && style.direction === 'rtl') {
            const rects = [...range.getClientRects()];
            const rect = endpoint === 'start' ? rects[0] : rects.at(-1);
            if (rect)
              position.x =
                frame.getBoundingClientRect().left +
                (endpoint === 'start' ? rect.right : rect.left);
          }
          if (position) next[endpoint] = { ...position, vertical };
        } catch {
          /* A page can unload while the reader changes layout. */
        }
      }
      setPositions(next);
    };
    update();
    view.addEventListener('relocate', update);
    view.addEventListener('pdf-selection-preview', update);
    view.renderer.addEventListener('scroll', update);
    return () => {
      revision.current++;
      drag.current = null;
      view.stopPDFSelectionHandle?.();
      view.removeEventListener('relocate', update);
      view.removeEventListener('pdf-selection-preview', update);
      view.renderer.removeEventListener('scroll', update);
    };
  }, [view, bookKey, selection]);

  const fail = () =>
    eventDispatcher.dispatch('toast', {
      type: 'error',
      message: _('Could not update highlight. Try again.'),
      timeout: 3000,
    });
  const start = (endpoint: Side) => {
    if (!view?.startPDFSelectionHandle) return;
    const id = ++revision.current;
    const ready = view.startPDFSelectionHandle(current.current.cfis, endpoint);
    const gesture = { ready, revision: id, point: undefined as Point | undefined };
    drag.current = gesture;
    setSide(endpoint);
    onStartEdit();
    void ready.then((ok) => {
      if (drag.current !== gesture || id !== revision.current) return;
      if (!ok) {
        cancel();
        fail();
      } else if (gesture.point) view.movePDFSelectionHandle?.(gesture.point);
    });
  };
  const move = (point: Point) => {
    if (!drag.current) return;
    drag.current.point = point;
    if (touch.current) setLoupe(point);
    view?.movePDFSelectionHandle?.(point);
  };
  const cancel = () => {
    revision.current++;
    drag.current = null;
    setSide(null);
    setLoupe(null);
    view?.deselect();
  };
  const finish = async () => {
    setLoupe(null);
    const gesture = drag.current;
    if (!gesture || !view) return;
    const ok = await gesture.ready;
    if (drag.current !== gesture || gesture.revision !== revision.current) return;
    if (gesture.point) view.movePDFSelectionHandle?.(gesture.point);
    view.stopPDFSelectionHandle?.();
    const fragments = view.getPDFSelection?.();
    if (!ok || !fragments?.length) {
      cancel();
      fail();
      return;
    }
    if (annotation) {
      const saved = await current.current.applyPDFAnnotationRanges(
        fragments,
        () => gesture.revision === revision.current,
      );
      if (!saved && gesture.revision === revision.current) {
        cancel();
        fail();
        return;
      }
    } else view.dispatchEvent(new Event('pdf-selection'));
    if (gesture.revision === revision.current) {
      drag.current = null;
      setSide(null);
    }
  };
  const color = settings.globalViewSettings.isEink
    ? isDarkMode
      ? '#ffffff'
      : '#000000'
    : (getHighlightColorHex(settings, handleColor) ?? '#d6c9a8');
  return (
    <div className='pointer-events-none fixed inset-0 z-50' data-pdf-range-editor=''>
      {(['start', 'end'] as const).map(
        (endpoint) =>
          positions[endpoint] && (
            <Handle
              key={endpoint}
              label={_(endpoint === 'start' ? 'Adjust selection start' : 'Adjust selection end')}
              position={positions[endpoint]!}
              hidden={side !== null && side !== endpoint}
              isVertical={positions[endpoint]!.vertical}
              type={endpoint}
              color={color}
              onDragStart={(pointerType) => {
                touch.current = pointerType !== 'mouse';
                start(endpoint);
              }}
              onDrag={move}
              onDragEnd={() => void finish()}
              onCancel={cancel}
              onKeyDown={async (event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  cancel();
                  return;
                }
                const directions: Record<string, 'left' | 'right' | 'backward' | 'forward'> = {
                  ArrowLeft: 'left',
                  ArrowRight: 'right',
                  ArrowUp: 'backward',
                  ArrowDown: 'forward',
                };
                const direction = directions[event.key];
                if (!direction || event.altKey || event.metaKey || event.ctrlKey) return;
                event.preventDefault();
                event.stopPropagation();
                if (keyBusy.current) return;
                keyBusy.current = true;
                try {
                  start(endpoint);
                  const gesture = drag.current;
                  if (gesture && (await gesture.ready) && gesture.revision === revision.current) {
                    if (await view?.extendPDFSelectionHandle?.(direction)) await finish();
                    else {
                      cancel();
                      fail();
                    }
                  }
                } finally {
                  keyBusy.current = false;
                }
              }}
            />
          ),
      )}
      {loupe && (
        <MagnifierLoupe
          bookKey={bookKey}
          dragPoint={loupe}
          isVertical={!!(side && positions[side]?.vertical)}
          color={color}
        />
      )}
    </div>
  );
}
