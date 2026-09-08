import clsx from 'clsx';
import React, { useRef } from 'react';
import { Search, Ellipsis, Pin, ChevronLeft } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { useTrafficLight } from '@/hooks/useTrafficLight';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import Dropdown from '@/components/Dropdown';
import BookMenu from './BookMenu';
import SidebarToggler from '../SidebarToggler';

const SidebarHeader: React.FC<{
  bookKey: string;
  isPinned: boolean;
  isSearchBarVisible: boolean;
  onClose: () => void;
  onTogglePin: () => void;
  onToggleSearchBar: () => void;
}> = ({ bookKey, isPinned, isSearchBarVisible, onClose, onTogglePin, onToggleSearchBar }) => {
  const _ = useTranslation();
  const headerRef = useRef<HTMLDivElement>(null);
  const { isTrafficLightVisible } = useTrafficLight(headerRef);
  const iconSize18 = useResponsiveSize(18);

  return (
    <div
      ref={headerRef}
      className={clsx(
        'sidebar-header glossa-reader-panel-header flex h-11 items-center justify-between pe-2',
        isTrafficLightVisible ? 'ps-1.5 sm:ps-20' : 'ps-1.5',
      )}
      dir='ltr'
    >
      <div className='flex items-center gap-x-8'>
        <button
          type='button'
          title={_('Close')}
          aria-label={_('Close')}
          onClick={onClose}
          className='glossa-icon-button touch-target btn btn-ghost flex h-8 min-h-8 w-8 p-0 sm:hidden'
        >
          <ChevronLeft size={iconSize18} aria-hidden='true' />
        </button>
        <div className='hidden sm:flex'>
          <SidebarToggler bookKey={bookKey} />
        </div>
      </div>
      <div className='flex min-w-24 max-w-32 items-center justify-between sm:size-[70%]'>
        <button
          type='button'
          title={isSearchBarVisible ? _('Hide Search Bar') : _('Show Search Bar')}
          aria-label={isSearchBarVisible ? _('Hide Search Bar') : _('Show Search Bar')}
          aria-expanded={isSearchBarVisible}
          aria-pressed={isSearchBarVisible}
          onClick={onToggleSearchBar}
          className={clsx(
            'glossa-icon-button touch-target btn btn-ghost h-8 min-h-8 w-8 p-0',
            isSearchBarVisible ? 'bg-base-300' : '',
          )}
        >
          <Search size={iconSize18} aria-hidden='true' />
        </button>
        <Dropdown
          label={_('Book Menu')}
          showTooltip={false}
          className={clsx(
            window.innerWidth < 640 ? 'dropdown-end' : 'dropdown-center',
            'dropdown-bottom',
          )}
          menuClassName={clsx('no-triangle mt-1', window.innerWidth < 640 ? '' : '!relative')}
          buttonClassName='glossa-icon-button btn btn-ghost h-8 min-h-8 w-8 p-0'
          containerClassName='h-8'
          toggleButton={<Ellipsis size={iconSize18} aria-hidden='true' />}
        >
          <BookMenu />
        </Dropdown>
        <div className='right-0 hidden h-8 w-8 items-center justify-center sm:flex'>
          <button
            type='button'
            title={isPinned ? _('Unpin Sidebar') : _('Pin Sidebar')}
            aria-label={isPinned ? _('Unpin Sidebar') : _('Pin Sidebar')}
            aria-pressed={isPinned}
            onClick={onTogglePin}
            className={clsx(
              'sidebar-pin-btn glossa-icon-button touch-target btn btn-ghost hidden h-8 min-h-8 w-8 p-0 sm:flex',
              isPinned && 'bg-base-300',
            )}
          >
            <Pin size={iconSize18} fill={isPinned ? 'currentColor' : 'none'} aria-hidden='true' />
          </button>
        </div>
      </div>
    </div>
  );
};

export default SidebarHeader;
