import clsx from 'clsx';
import React, { useCallback } from 'react';
import { ChevronRight } from '@/components/GlossaIcons';
import { TOCItem } from '@/libs/document';
import { getContentMd5 } from '@/utils/misc';

const createExpanderIcon = (isExpanded: boolean) => (
  <ChevronRight
    size={14}
    className={clsx('shrink-0 transition-transform', isExpanded && 'rotate-90')}
    aria-hidden='true'
  />
);

export interface FlatTOCItem {
  item: TOCItem;
  depth: number;
  index: number;
  isExpanded?: boolean;
}

const TOCItemView = React.memo<{
  bookKey: string;
  flatItem: FlatTOCItem;
  itemSize?: number;
  isActive: boolean;
  onToggleExpand: (item: TOCItem) => void;
  onItemClick: (item: TOCItem) => void;
}>(({ flatItem, itemSize, isActive, onToggleExpand, onItemClick }) => {
  const { item, depth } = flatItem;

  const pageNumber = item.location
    ? item.location.current + 1
    : item.index !== undefined
      ? item.index + 1
      : null;
  const ariaLabel = item.label
    ? pageNumber !== null
      ? `${item.label}, ${pageNumber}`
      : item.label
    : undefined;

  const handleToggleExpand = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      onToggleExpand(item);
    },
    [item, onToggleExpand],
  );

  const handleClickItem = useCallback(
    (event: React.MouseEvent | React.KeyboardEvent) => {
      event.preventDefault();
      onItemClick(item);
    },
    [item, onItemClick],
  );

  return (
    <div
      tabIndex={0}
      role='treeitem'
      onClick={item.href ? handleClickItem : undefined}
      onKeyDown={item.href ? (e) => e.key === 'Enter' && handleClickItem(e) : undefined}
      aria-label={ariaLabel}
      aria-current={isActive ? 'page' : undefined}
      aria-expanded={item.subitems ? (flatItem.isExpanded ? 'true' : 'false') : undefined}
      aria-selected={isActive ? 'true' : 'false'}
      data-href={item.href ? getContentMd5(item.href) : undefined}
      className={clsx(
        'glossa-reader-toc-item flex w-full cursor-pointer items-center rounded-lg py-4 sm:py-2',
      )}
      style={{
        height: itemSize ? `${itemSize}px` : 'auto',
        paddingInlineStart: `${(depth + 1) * 12}px`,
      }}
    >
      {item.subitems && (
        <button
          onClick={handleToggleExpand}
          onKeyDown={(e) => {
            e.stopPropagation();
          }}
          aria-label={flatItem.isExpanded ? `Collapse ${item.label}` : `Expand ${item.label}`}
          className='inline-block cursor-pointer'
          style={{
            padding: '12px',
            margin: '-12px',
          }}
        >
          {createExpanderIcon(flatItem.isExpanded || false)}
        </button>
      )}
      <div
        className='ms-2 truncate text-ellipsis'
        style={{
          maxWidth: 'calc(100% - 24px)',
          whiteSpace: 'nowrap',
          textOverflow: 'ellipsis',
        }}
      >
        {item.label}
      </div>
      {(item.location || item.index !== undefined) && (
        <div aria-hidden='true' className='glossa-reader-toc-page ms-auto ps-2 font-mono sm:pe-2'>
          {item.location ? item.location.current + 1 : item.index + 1}
        </div>
      )}
    </div>
  );
});

TOCItemView.displayName = 'TOCItemView';

interface ListRowProps {
  bookKey: string;
  flatItem: FlatTOCItem;
  itemSize?: number;
  activeHref: string | null;
  onToggleExpand: (item: TOCItem) => void;
  onItemClick: (item: TOCItem) => void;
}

export const StaticListRow: React.FC<ListRowProps> = ({
  bookKey,
  flatItem,
  itemSize,
  activeHref,
  onToggleExpand,
  onItemClick,
}) => {
  const isActive = activeHref === flatItem.item.href;

  return (
    <div
      className={clsx(
        'border-base-300 w-full border-b sm:border-none',
        'pe-4 ps-2 pt-[1px] sm:pe-2',
      )}
      title={flatItem.item.label || ''}
    >
      <TOCItemView
        bookKey={bookKey}
        flatItem={flatItem}
        itemSize={itemSize}
        isActive={isActive}
        onToggleExpand={onToggleExpand}
        onItemClick={onItemClick}
      />
    </div>
  );
};
