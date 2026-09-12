import { generateReadingGuide, getReadingGuideCacheKey } from '@/glossa/guide/generate';
import { loadReadingGuide, saveReadingGuide } from '@/glossa/guide/store';
import type { ReadingGuide } from '@/glossa/guide/types';
import ReadingGuideDocument from './ReadingGuideDocument';
import ReadingPassagePanel, {
  type ReadingPanelAdapter,
  type ReadingPanelProps,
} from './ReadingPassagePanel';

const adapter: ReadingPanelAdapter<ReadingGuide> = {
  id: 'guide',
  unsaved: new Map(),
  generate: generateReadingGuide,
  load: loadReadingGuide,
  save: saveReadingGuide,
  cacheKey: getReadingGuideCacheKey,
  Document: ReadingGuideDocument,
};
export default function ReadingGuidePanel(props: ReadingPanelProps) {
  return <ReadingPassagePanel {...props} adapter={adapter} />;
}
