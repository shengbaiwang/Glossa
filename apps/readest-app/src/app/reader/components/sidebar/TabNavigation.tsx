import clsx from 'clsx';
import React from 'react';
import { Bookmark, List, Highlighter } from 'lucide-react';

import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';

const TabNavigation: React.FC<{
  activeTab: string;
  onTabChange: (tab: string) => void;
}> = ({ activeTab, onTabChange }) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const tabs = [
    { id: 'toc', label: _('TOC'), Icon: List },
    { id: 'annotations', label: _('Annotate'), Icon: Highlighter },
    { id: 'bookmarks', label: _('Bookmark'), Icon: Bookmark },
  ];

  return (
    <div
      className={clsx(
        'bottom-tab glossa-reader-tabs flex w-full gap-1 border-t p-2',
        appService?.hasRoundedWindow && 'rounded-window-bottom-left',
      )}
      role='group'
      aria-label={_('Sidebar')}
    >
      {tabs.map(({ id, label, Icon }) => (
        <button
          key={id}
          type='button'
          className='glossa-reader-tab flex min-h-12 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-lg px-1 py-1.5'
          onClick={() => onTabChange(id)}
          title={label}
          aria-label={label}
          aria-pressed={activeTab === id}
        >
          <Icon size={18} aria-hidden='true' />
          <span className='max-w-full truncate text-[11px] font-medium leading-4'>{label}</span>
        </button>
      ))}
    </div>
  );
};

export default TabNavigation;
