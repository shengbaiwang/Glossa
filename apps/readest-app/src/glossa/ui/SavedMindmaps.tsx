import { useEffect, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { listSavedMindmaps } from '@/glossa/mindmap/store';
import type { ReadingMindmap } from '@/glossa/mindmap/types';
import type { ReadingPanelProps } from './ReadingPassagePanel';
import MindmapDocument from './MindmapDocument';
import MindmapSourcePanel, { type MindmapSourceSelection } from './MindmapSourcePanel';

export default function SavedMindmaps({
  book,
  bookDoc,
  bookKey,
  onNavigate,
  onUseMap,
}: ReadingPanelProps & { onNavigate?: () => void; onUseMap?: (map: ReadingMindmap) => void }) {
  const _ = useTranslation();
  const [maps, setMaps] = useState<ReadingMindmap[] | null>(null);
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [source, setSource] = useState<MindmapSourceSelection | null>(null);
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
    };
  }, [book.hash, retry]);
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
            setError('');
            setSource(null);
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
          key={`map-${current.id}`}
          guide={current}
          sources={current.sources}
          onSource={(item, node) => {
            setSource({
              nodeId: node?.id ?? item.sourceId,
              sources: node
                ? node.sourceIds.flatMap((id) => current.sources.filter((s) => s.sourceId === id))
                : [item],
            });
          }}
        />
      )}
      {current && onUseMap && !current.insufficientEvidence && (
        <button type='button' className='glossa-button' onClick={() => onUseMap(current)}>
          {_('Edit mind map')}
        </button>
      )}
      {current && (
        <MindmapSourcePanel
          key={`source-${current.id}`}
          book={book}
          bookDoc={bookDoc}
          bookKey={bookKey}
          selection={source}
          onNavigate={onNavigate}
        />
      )}
    </section>
  );
}
