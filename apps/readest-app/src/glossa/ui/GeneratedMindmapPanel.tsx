import { generateMindmap, getMindmapCacheKey } from '@/glossa/mindmap/generate';
import { loadMindmap, saveMindmap } from '@/glossa/mindmap/store';
import type { ReadingMindmap } from '@/glossa/mindmap/types';
import MindmapDocument from './MindmapDocument';
import ReadingPassagePanel, {
  type ReadingPanelAdapter,
  type ReadingPanelProps,
} from './ReadingPassagePanel';

const adapter: ReadingPanelAdapter<ReadingMindmap> = {
  id: 'mindmap',
  directNavigation: true,
  unsaved: new Map(),
  generate: generateMindmap,
  load: loadMindmap,
  save: saveMindmap,
  cacheKey: getMindmapCacheKey,
  Document: MindmapDocument,
};
interface Props extends ReadingPanelProps {
  onUseMap?: (map: ReadingMindmap) => void;
}

export default function GeneratedMindmapPanel({ onUseMap, ...props }: Props) {
  return <ReadingPassagePanel {...props} adapter={adapter} onUseResult={onUseMap} />;
}
