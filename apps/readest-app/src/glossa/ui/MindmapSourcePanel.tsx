import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Undo2, X } from '@/components/GlossaIcons';
import { useTranslation } from '@/hooks/useTranslation';
import { useReaderStore } from '@/store/readerStore';
import { resolveSource } from '@/glossa/citations/sources';
import { navigateSource } from '@/glossa/citations/navigation';
import type { ChapterSource } from '@/glossa/context/types';
import type { ReadingPanelProps } from './ReadingPassagePanel';

export interface MindmapSourceSelection {
  nodeId: string;
  sources: ChapterSource[];
}

/** The excerpt is local text, independent of the editable idea and model explanation. */
export default function MindmapSourcePanel({
  bookDoc,
  bookKey,
  selection,
  contextLabel,
  onNavigate,
}: ReadingPanelProps & {
  selection: MindmapSourceSelection | null;
  contextLabel?: string;
  onNavigate?: () => void;
}) {
  const _ = useTranslation();
  const [index, setIndex] = useState(0);
  const [preview, setPreview] = useState<{ text: string; verified: boolean } | null>(null);
  const [origin, setOrigin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [errorAction, setErrorAction] = useState<'source' | 'return'>('source');
  const request = useRef<AbortController | null>(null);
  const show = async (next: number) => {
    request.current?.abort();
    const source = selection?.sources[next];
    if (!source) return;
    const controller = new AbortController();
    request.current = controller;
    setIndex(next);
    setPreview({ text: source.text, verified: false });
    setBusy(true);
    setError('');
    setErrorAction('source');
    let verified = false;
    try {
      const resolved = await resolveSource(bookDoc, source, { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (!resolved) throw new Error('Unresolved source');
      verified = true;
      setPreview({ text: resolved.text, verified: true });
      const reader = useReaderStore.getState();
      const view = reader.getView(bookKey);
      if (!view) throw new Error('Missing reader');
      // Keep the return point even if Foliate finishes moving after cancellation.
      setOrigin((previous) => previous || reader.getProgress(bookKey)?.location || '');
      await navigateSource(view, resolved.cfi, controller.signal);
      if (!controller.signal.aborted) onNavigate?.();
    } catch {
      if (!controller.signal.aborted)
        setError(
          verified
            ? 'Could not open the source passage.'
            : 'The source location could not be verified.',
        );
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  };
  useEffect(() => {
    setPreview(null);
    setError('');
    setBusy(false);
    if (selection) void show(0);
    return () => request.current?.abort();
  }, [selection, bookDoc, bookKey]);

  const goBack = async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError('');
    setErrorAction('return');
    try {
      const view = useReaderStore.getState().getView(bookKey);
      if (!view) throw new Error('Missing reader');
      await navigateSource(view, origin, controller.signal);
      if (!controller.signal.aborted) {
        setOrigin('');
        onNavigate?.();
      }
    } catch {
      if (!controller.signal.aborted)
        setError('Could not return to the previous reading position.');
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  };

  return (
    <>
      {preview && (
        <aside className='glossa-workmap-source' aria-label={_('Source excerpt')}>
          <header>
            <div>
              <strong>{_('Original passage')}</strong>
              {contextLabel && (
                <span className='glossa-workmap-source-kind'>{_(contextLabel)}</span>
              )}
            </div>
            <div className='glossa-workmap-source-actions'>
              {selection && selection.sources.length > 1 && (
                <>
                  <button
                    type='button'
                    aria-label={_('Previous passage')}
                    title={_('Previous passage')}
                    disabled={index === 0}
                    onClick={() => void show(index - 1)}
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <button
                    type='button'
                    aria-label={_('Next passage')}
                    title={_('Next passage')}
                    disabled={index === selection.sources.length - 1}
                    onClick={() => void show(index + 1)}
                  >
                    <ChevronRight size={16} />
                  </button>
                </>
              )}
              <button
                type='button'
                aria-label={_('Close source excerpt')}
                title={_('Close source excerpt')}
                onClick={() => {
                  request.current?.abort();
                  setPreview(null);
                  setBusy(false);
                  setError('');
                }}
              >
                <X size={16} />
              </button>
            </div>
          </header>
          <blockquote dir='auto'>{preview.text}</blockquote>
          {(!preview.verified || busy) && (
            <p role='status'>{_(busy ? 'Locating source…' : 'Saved excerpt · unverified')}</p>
          )}
        </aside>
      )}
      {error && (
        <div className='glossa-workmap-error' role='alert'>
          <p>{_(error)}</p>
          {(preview || origin) && (
            <button
              type='button'
              onClick={() => void (errorAction === 'return' ? goBack() : show(index))}
            >
              {_('Retry')}
            </button>
          )}
        </div>
      )}
      {origin && (
        <div className='glossa-workmap-return'>
          <button type='button' disabled={busy} onClick={() => void goBack()}>
            <Undo2 size={15} />
            {_('Back to reading position')}
          </button>
        </div>
      )}
    </>
  );
}
