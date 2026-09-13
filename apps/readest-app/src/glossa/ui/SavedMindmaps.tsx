import { useEffect, useRef, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { useReaderStore } from '@/store/readerStore';
import { resolveSource } from '@/glossa/citations/sources';
import { navigateGuideSource } from '@/glossa/citations/navigation';
import { listSavedMindmaps } from '@/glossa/mindmap/store';
import type { ReadingMindmap } from '@/glossa/mindmap/types';
import type { ChapterSource } from '@/glossa/context/types';
import type { ReadingPanelProps } from './ReadingPassagePanel';
import MindmapDocument from './MindmapDocument';

export default function SavedMindmaps({
  book,
  bookDoc,
  bookKey,
  onNavigate,
}: ReadingPanelProps & { onNavigate?: () => void }) {
  const _ = useTranslation();
  const [maps, setMaps] = useState<ReadingMindmap[] | null>(null);
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [origin, setOrigin] = useState('');
  const [busy, setBusy] = useState(false);
  const navigation = useRef<AbortController | null>(null);
  useEffect(() => {
    let active = true;
    setError('');
    setMaps(null);
    void listSavedMindmaps(book.hash)
      .then((results) => {
        if (active) {
          setMaps(results);
          setSelected(results[0]?.id ?? '');
        }
      })
      .catch(() => {
        if (active) setError('Saved mind maps could not be loaded.');
      });
    return () => {
      active = false;
      navigation.current?.abort();
    };
  }, [book.hash, retry]);
  const navigate = async (source?: ChapterSource) => {
    navigation.current?.abort();
    const controller = new AbortController();
    navigation.current = controller;
    setError('');
    setBusy(true);
    try {
      const reader = useReaderStore.getState();
      const view = reader.getView(bookKey);
      const resolved = source
        ? await resolveSource(bookDoc, source, { signal: controller.signal })
        : null;
      if (controller.signal.aborted) return;
      const cfi = source ? resolved?.cfi : origin;
      if (!view || !cfi) throw new Error('Unresolved source');
      if (source) setOrigin((previous) => previous || reader.getProgress(bookKey)?.location || '');
      await navigateGuideSource(view, cfi, controller.signal);
      if (!controller.signal.aborted) {
        if (!source) setOrigin('');
        onNavigate?.();
      }
    } catch {
      if (!controller.signal.aborted)
        setError(
          source
            ? 'The source location could not be verified.'
            : 'Could not return to the previous reading position.',
        );
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  };
  const current = maps?.find((m) => m.id === selected);
  return (
    <section className='glossa-workmap-archive'>
      {!maps && !error && <p role='status'>{_('Loading mind maps…')}</p>}
      {maps?.length === 0 && <p>{_('No earlier generated maps')}</p>}
      {maps && maps.length > 0 && (
        <select
          aria-label={_('Earlier generated maps')}
          value={selected}
          onChange={(event) => {
            navigation.current?.abort();
            setBusy(false);
            setError('');
            setSelected(event.target.value);
          }}
        >
          {maps.map((m) => (
            <option key={m.id} value={m.id}>
              {m.nodes.find((n) => n.parentId === null)?.label ?? _('Mind map')} ·{' '}
              {new Date(m.createdAt).toLocaleDateString()}
            </option>
          ))}
        </select>
      )}
      {origin && (
        <button
          type='button'
          className='glossa-button'
          disabled={busy}
          onClick={() => void navigate()}
        >
          {_('Back to reading position')}
        </button>
      )}
      {busy && <p role='status'>{_('Locating source…')}</p>}
      {error && (
        <p role='alert'>
          {_(error)}
          {!maps && (
            <button type='button' className='glossa-button' onClick={() => setRetry((n) => n + 1)}>
              {_('Retry')}
            </button>
          )}
        </p>
      )}
      {current && (
        <MindmapDocument
          key={current.id}
          guide={current}
          sources={current.sources}
          onSource={(source) => void navigate(source)}
        />
      )}
    </section>
  );
}
