import clsx from 'clsx';
import { useEffect, useRef } from 'react';
import {
  Trash2,
  BookOpen,
  X,
  Info,
  CircleCheck,
  CloudDownload,
  Send,
  FolderPlus,
} from 'lucide-react';
import { useKeyDownActions } from '@/hooks/useKeyDownActions';
import { useTranslation } from '@/hooks/useTranslation';
import { isMd5 } from '@/utils/md5';

interface SelectModeActionsProps {
  selectedBooks: string[];
  safeAreaBottom: number;
  // When false (Linux desktop, Windows desktop, web) the Send button is
  // hidden entirely — those platforms can't surface a system share sheet
  // so the affordance would be misleading. Note: this is *file send* (hands
  // the book file to the OS share sheet), distinct from "Share Book" in
  // the per-item context menu, which generates a remote share link.
  sendEnabled?: boolean;
  // False when nothing in the selection can be pulled from the cloud — every
  // selected book is either already on this device or was never uploaded.
  canDownload?: boolean;
  onOpen: () => void;
  onGroup: () => void;
  onDetails: () => void;
  onStatus: () => void;
  // Queues every cloud-only book in the selection, groups included (#5244).
  onDownload: () => void;
  // The macOS / iPad share popover is anchored to the selected book's
  // cover (located via its data-book-hash attribute), not to this
  // button — the user's visual focus is on the cover they just tapped.
  // On iOS / Android the share sheet is modal and ignores position.
  onSend: () => void;
  onDelete: () => void;
  onCancel: () => void;
  // Reports the popup's rendered height (including its safe-area padding) so the
  // shelf can reserve matching trailing space and keep the last book from being
  // hidden behind this fixed bar (#5175). Reports 0 on unmount.
  onHeightChange?: (height: number) => void;
}

const SelectModeActions: React.FC<SelectModeActionsProps> = ({
  selectedBooks,
  safeAreaBottom,
  sendEnabled = true,
  canDownload = false,
  onOpen,
  onGroup,
  onDetails,
  onStatus,
  onDownload,
  onSend,
  onDelete,
  onCancel,
  onHeightChange,
}) => {
  const _ = useTranslation();

  const hasSelection = selectedBooks.length > 0;
  const hasValidBooks = selectedBooks.every((id) => isMd5(id));
  const hasSingleSelection = selectedBooks.length === 1;
  const rootRef = useRef<HTMLDivElement | null>(null);
  useKeyDownActions({ onCancel, elementRef: rootRef });

  useEffect(() => {
    if (!onHeightChange) return;
    const el = rootRef.current;
    if (!el) return;
    const report = () => onHeightChange(el.getBoundingClientRect().height);
    report();
    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(report);
      observer.observe(el);
    }
    return () => {
      observer?.disconnect();
      onHeightChange(0);
    };
  }, [onHeightChange]);

  return (
    <div
      ref={rootRef}
      className='glossa-selection-actions fixed bottom-0 start-0 end-0 z-40'
      style={{
        paddingBottom: `${safeAreaBottom + 16}px`,
      }}
    >
      <div
        className={clsx(
          'glossa-selection-action-bar text-base-content text-xs',
          'eink-bordered',
          'mx-auto w-fit max-w-[calc(100vw-1rem)] rounded-lg p-4',
          'flex items-center justify-center gap-x-6',
          'max-[500px]:grid max-[500px]:grid-cols-4 max-[500px]:gap-x-6 max-[500px]:gap-y-3',
        )}
      >
        <button
          onClick={onOpen}
          className={clsx(
            'flex flex-col items-center justify-center gap-1',
            (!hasSelection || !hasValidBooks) && 'btn-disabled opacity-50',
          )}
        >
          <BookOpen />
          <div>{_('Open')}</div>
        </button>
        <button
          onClick={onGroup}
          className={clsx(
            'flex flex-col items-center justify-center gap-1',
            !hasSelection && 'btn-disabled opacity-50',
          )}
        >
          <FolderPlus />
          <div>{_('Group')}</div>
        </button>
        <button
          onClick={onStatus}
          className={clsx(
            'flex flex-col items-center justify-center gap-1',
            (!hasSelection || !hasValidBooks) && 'btn-disabled opacity-50',
          )}
        >
          <CircleCheck />
          <div>{_('Status')}</div>
        </button>
        <button
          onClick={onDetails}
          className={clsx(
            'flex flex-col items-center justify-center gap-1',
            (!hasSingleSelection || !hasValidBooks) && 'btn-disabled opacity-50',
          )}
        >
          <Info />
          <div>{_('Details')}</div>
        </button>
        <button
          onClick={onDownload}
          className={clsx(
            'flex flex-col items-center justify-center gap-1',
            // Heads the second row on narrow viewports; everything after it
            // (Send / Delete / Cancel) then flows behind it.
            'max-[500px]:col-start-1',
            !canDownload && 'btn-disabled opacity-50',
          )}
        >
          <CloudDownload />
          <div>{_('Download')}</div>
        </button>
        {sendEnabled && (
          <button
            onClick={onSend}
            className={clsx(
              'flex flex-col items-center justify-center gap-1',
              (!hasSingleSelection || !hasValidBooks) && 'btn-disabled opacity-50',
            )}
          >
            <Send />
            <div>{_('Send')}</div>
          </button>
        )}
        <button
          onClick={onDelete}
          className={clsx(
            'flex flex-col items-center justify-center gap-1',
            !hasSelection && 'btn-disabled opacity-50',
          )}
        >
          <Trash2 className='text-red-500' />
          <div className='text-red-500'>{_('Delete')}</div>
        </button>
        <button onClick={onCancel} className='flex flex-col items-center justify-center gap-1'>
          <X />
          <div>{_('Cancel')}</div>
        </button>
      </div>
    </div>
  );
};

export default SelectModeActions;
