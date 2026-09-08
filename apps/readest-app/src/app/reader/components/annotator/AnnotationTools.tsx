import { Search, Copy, Link, Highlighter, SquarePen } from 'lucide-react';
import { IconType } from 'react-icons';
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
    Icon: Copy,
    quickAction: true,
  },
  {
    type: 'copylink',
    label: _('Copy Link'),
    tooltip: _('Copy link to text after selection'),
    Icon: Link,
  },
  {
    type: 'highlight',
    label: _('Highlight'),
    tooltip: _('Highlight text after selection'),
    Icon: Highlighter,
    quickAction: true,
  },
  {
    type: 'annotate',
    label: _('Annotate'),
    tooltip: _('Annotate text after selection'),
    Icon: SquarePen,
  },
  {
    type: 'search',
    label: _('Search'),
    tooltip: _('Search text after selection'),
    Icon: Search,
    quickAction: true,
  },
];

export const annotationToolQuickActions = annotationToolButtons.filter(
  (button) => button.quickAction,
);
