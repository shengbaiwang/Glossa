import React, { useId, useRef } from 'react';
import { useTranslation } from '@/hooks/useTranslation';

const TabNavigation: React.FC<{
  activeTab: string;
  onTabChange: (tab: string) => void;
  idPrefix?: string;
  showStudyNotes?: boolean;
}> = ({ activeTab, onTabChange, idPrefix, showStudyNotes = false }) => {
  const _ = useTranslation();
  const localId = useId();
  const prefix = idPrefix ?? localId;
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const tabs = [
    { id: 'toc', label: _('Contents') },
    { id: 'annotations', label: _('Notes') },
    { id: 'bookmarks', label: _('Bookmarks') },
    ...(showStudyNotes ? [{ id: 'study', label: _('Study') }] : []),
  ];

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const isRTL = event.currentTarget.closest('[dir]')?.getAttribute('dir') === 'rtl';
    let nextIndex: number;
    switch (event.key) {
      case 'ArrowRight':
        nextIndex = (index + (isRTL ? -1 : 1) + tabs.length) % tabs.length;
        break;
      case 'ArrowLeft':
        nextIndex = (index + (isRTL ? 1 : -1) + tabs.length) % tabs.length;
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = tabs.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    tabRefs.current[nextIndex]?.focus();
    onTabChange(tabs[nextIndex]!.id);
  };

  return (
    <div
      className='glossa-reader-tabs flex w-full shrink-0 gap-1 px-3 pb-2'
      role='tablist'
      aria-label={_('Sidebar')}
      aria-orientation='horizontal'
    >
      {tabs.map(({ id, label }, index) => (
        <button
          key={id}
          ref={(element) => {
            tabRefs.current[index] = element;
          }}
          id={`${prefix}-tab-${id}`}
          type='button'
          role='tab'
          className='glossa-reader-tab flex min-h-9 min-w-0 flex-1 items-center justify-center rounded-lg px-2 py-2'
          onClick={() => onTabChange(id)}
          onKeyDown={(event) => handleKeyDown(event, index)}
          title={label}
          aria-label={label}
          aria-selected={activeTab === id}
          aria-controls={idPrefix ? `${prefix}-panel` : undefined}
          tabIndex={activeTab === id ? 0 : -1}
        >
          <span className='max-w-full truncate text-xs font-medium leading-4'>{label}</span>
        </button>
      ))}
    </div>
  );
};

export default TabNavigation;
