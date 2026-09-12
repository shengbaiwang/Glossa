import { generateMindmap, getMindmapCacheKey } from '@/glossa/mindmap/generate';
import { loadMindmap, saveMindmap } from '@/glossa/mindmap/store';
import type { ReadingMindmap } from '@/glossa/mindmap/types';
import { stubTranslation as _ } from '@/utils/misc';
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
  strings: {
    Guide: _('Mind map'),
    'Choose the passage you are reading. Start with a short guide, then unfold only what needs explaining.':
      _('Choose a passage to map its ideas and connections.'),
    'Generate guide': _('Generate mind map'),
    'Regenerate guide': _('Regenerate mind map'),
    'Guide saved on this device.': _('Mind map saved on this device.'),
    'The guide could not be saved on this device.': _(
      'The mind map could not be saved on this device.',
    ),
    'Saved guide could not be loaded.': _('Saved mind map could not be loaded.'),
    'Could not generate the guide. Check the model service and try again.': _(
      'Could not generate the mind map. Check the model service and try again.',
    ),
    'This passage is too long to guide safely. Choose another passage.': _(
      'This passage is too long to map safely. Choose another passage.',
    ),
    'Loading saved guide…': _('Loading saved mind map…'),
    'Retry loading guide': _('Retry loading mind map'),
    'Writing guide…': _('Mapping connections…'),
    'Preparing guide…': _('Preparing mind map…'),
    'This guide has not been saved yet.': _('This mind map has not been saved yet.'),
    'Retry saving guide': _('Retry saving mind map'),
    'This saved guide uses earlier text or model settings.': _(
      'This saved mind map uses earlier text or model settings.',
    ),
  },
};
export default function MindmapPanel(props: ReadingPanelProps) {
  return <ReadingPassagePanel {...props} adapter={adapter} />;
}
