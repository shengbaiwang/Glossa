import { Contents, Bookmark } from '@/components/GlossaIcons';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import React, { useId, useRef } from 'react';
import { useTranslation } from '@/hooks/useTranslation';

const TabNavigation: React.FC<{
  activeTab: string;
  onTabChange: (tab: string) => void;
  idPrefix?: string;
}> = ({ activeTab, onTabChange, idPrefix }) => {
  const _ = useTranslation();
  const iconSize = useResponsiveSize(18);
  const localId = useId();
  const prefix = idPrefix ?? localId;
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const tabs = [
    { id: 'toc', label: _('Contents'), Icon: Contents },
    { id: 'bookmarks', label: _('Bookmarks'), Icon: Bookmark },
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
      className='glossa-reader-tabs glossa-sidebar-tabs'
      role='tablist'
      aria-label={_('Sidebar')}
      aria-orientation='horizontal'
    >
      {tabs.map(({ id, label, Icon }, index) => (
        <button
          key={id}
          ref={(element) => {
            tabRefs.current[index] = element;
          }}
          id={`${prefix}-tab-${id}`}
          type='button'
          role='tab'
          className='glossa-reader-tab glossa-icon-button'
          onClick={() => onTabChange(id)}
          onKeyDown={(event) => handleKeyDown(event, index)}
          title={label}
          aria-label={label}
          aria-selected={activeTab === id}
          aria-controls={idPrefix ? `${prefix}-panel` : undefined}
          tabIndex={activeTab === id ? 0 : -1}
        >
          <Icon size={iconSize} aria-hidden='true' />
        </button>
      ))}
    </div>
  );
};

export default TabNavigation;
