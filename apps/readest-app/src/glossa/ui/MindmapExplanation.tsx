import { useTranslation } from '@/hooks/useTranslation';
import type { MindmapNode } from '@/glossa/mindmap/schema';

/** Model commentary is kept separate from the locally verified source excerpt. */
export default function MindmapExplanation({
  node,
  edited = false,
}: {
  node: MindmapNode;
  edited?: boolean;
}) {
  const _ = useTranslation();
  return (
    <aside className='glossa-map-explanation' aria-label={_('Generated explanation')}>
      <strong>{_('Generated explanation')}</strong>
      {edited && <p dir='auto'>{_('Original idea: {{text}}', { text: node.label })}</p>}
      {node.kind === 'inference' && <span>{_('Interpretation')}</span>}
      <p dir='auto'>{node.explanation}</p>
    </aside>
  );
}
