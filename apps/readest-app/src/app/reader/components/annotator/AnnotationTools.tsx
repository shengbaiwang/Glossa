import { IconType } from 'react-icons';
import { FiSearch } from 'react-icons/fi';
import { FiCopy } from 'react-icons/fi';
import { FiLink } from 'react-icons/fi';
import { PiHighlighterFill } from 'react-icons/pi';
import { BsPencilSquare } from 'react-icons/bs';
import { AnnotationToolType } from '@/types/annotator';
import { stubTranslation as _ } from '@/utils/misc';

type AnnotationToolButton = {
  type: AnnotationToolType;
  label: string;
  tooltip: string;
  Icon: IconType;
  quickAction?: boolean;
};

export const annotationToolButtons: AnnotationToolButton[] = [
  {
    type: 'copy',
    label: _('Copy'),
    tooltip: _('Copy text after selection'),
    Icon: FiCopy,
    quickAction: true,
  },
  {
    type: 'copylink',
    label: _('Copy Link'),
    tooltip: _('Copy link to text after selection'),
    Icon: FiLink,
  },
  {
    type: 'highlight',
    label: _('Highlight'),
    tooltip: _('Highlight text after selection'),
    Icon: PiHighlighterFill,
    quickAction: true,
  },
  {
    type: 'annotate',
    label: _('Annotate'),
    tooltip: _('Annotate text after selection'),
    Icon: BsPencilSquare,
  },
  {
    type: 'search',
    label: _('Search'),
    tooltip: _('Search text after selection'),
    Icon: FiSearch,
    quickAction: true,
  },
];

export const annotationToolQuickActions = annotationToolButtons.filter(
  (button) => button.quickAction,
);
