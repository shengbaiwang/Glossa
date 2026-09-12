import { useId, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import type { MindmapBody, MindmapNode } from '@/glossa/mindmap/schema';
import type { ChapterSource } from '@/glossa/context/types';

interface Props {
  guide: MindmapBody;
  sources: ChapterSource[];
  onSource: (source: ChapterSource) => void;
}

export default function MindmapDocument({ guide, sources, onSource }: Props) {
  const _ = useTranslation();
  const prefix = useId();
  const root = guide.nodes.find((node) => node.parentId === null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(root ? [root.id] : []));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const branches = guide.nodes.filter((node) =>
    guide.nodes.some((child) => child.parentId === node.id),
  );
  const allExpanded = branches.every((node) => expanded.has(node.id));

  const renderNode = (node: MindmapNode): React.ReactNode => {
    const children = guide.nodes.filter((child) => child.parentId === node.id);
    const open = expanded.has(node.id);
    return (
      <li key={node.id} className='glossa-map-branch'>
        {node.parentId !== null && (
          <p className='glossa-map-relation' dir='auto'>
            {node.relation}
          </p>
        )}
        <div className='glossa-map-node eink-bordered' data-selected={selectedId === node.id}>
          <button
            type='button'
            className='glossa-map-label'
            dir='auto'
            aria-pressed={selectedId === node.id}
            title={
              node.kind === 'inference'
                ? _('Interpretation: {{text}}', { text: node.explanation })
                : node.explanation
            }
            onClick={() => {
              const source = sources.find((item) => item.sourceId === node.sourceIds[0]);
              if (source) {
                setSelectedId(node.id);
                onSource(source);
              }
            }}
          >
            {node.label}
          </button>
          {children.length > 0 && (
            <button
              type='button'
              className='glossa-map-toggle'
              aria-label={_(open ? 'Collapse {{node}}' : 'Expand {{node}}', { node: node.label })}
              aria-expanded={open}
              aria-controls={`${prefix}-${node.id}`}
              onClick={() =>
                setExpanded((previous) => {
                  const next = new Set(previous);
                  if (open) next.delete(node.id);
                  else next.add(node.id);
                  return next;
                })
              }
            >
              {open ? '−' : '+'}
            </button>
          )}
        </div>
        {children.length > 0 && (
          <ul id={`${prefix}-${node.id}`} hidden={!open} className='glossa-map-children'>
            {children.map(renderNode)}
          </ul>
        )}
      </li>
    );
  };

  return (
    <article className='glossa-mindmap select-text' aria-label={_('Generated mind map')}>
      {guide.insufficientEvidence ? (
        <p role='status' className='glossa-guide-message'>
          {_('This passage does not contain enough evidence for a mind map.')}
        </p>
      ) : (
        <>
          <div className='glossa-map-toolbar' role='group' aria-label={_('Mind map controls')}>
            <button
              type='button'
              className='glossa-guide-text-button'
              onClick={() => {
                setExpanded(new Set(allExpanded ? [] : branches.map((n) => n.id)));
              }}
            >
              {_(allExpanded ? 'Collapse branches' : 'Expand all')}
            </button>
            <div className='glossa-map-size'>
              <button
                type='button'
                className='glossa-guide-text-button'
                aria-label={_('Smaller nodes')}
                disabled={scale <= 0.9}
                onClick={() => setScale((n) => Math.max(0.9, n - 0.1))}
              >
                −
              </button>
              <button
                type='button'
                className='glossa-guide-text-button'
                aria-label={_('Larger nodes')}
                disabled={scale >= 1.3}
                onClick={() => setScale((n) => Math.min(1.3, n + 0.1))}
              >
                +
              </button>
            </div>
          </div>
          <ul
            className='glossa-map-tree'
            style={{ fontSize: `${14 * scale}px` }}
            aria-label={_('Idea connections')}
          >
            {root && renderNode(root)}
          </ul>
        </>
      )}
    </article>
  );
}
