import * as React from 'react';
import clsx from 'clsx';
import { IconType } from 'react-icons';

interface EmptyStateProps {
  Icon: IconType;
  label: string;
  hint?: string;
  action?: React.ReactNode;
  className?: string;
}

/**
 * Compact empty-state for reader side panels (annotations, bookmarks, notes):
 * a large muted icon above a title and either a one-line hint or an action
 * (e.g. a button), matching the library empty-state's tone.
 */
const EmptyState: React.FC<EmptyStateProps> = ({ Icon, label, hint, action, className }) => (
  <div
    className={clsx(
      'glossa-reader-empty flex select-none flex-col items-center justify-center gap-2 px-6 text-center',
      className,
    )}
  >
    <div className='glossa-reader-empty-icon eink-bordered mb-3 flex h-16 w-16 items-center justify-center rounded-2xl'>
      <Icon aria-hidden='true' size={28} />
    </div>
    <p className='text-base-content text-sm font-semibold'>{label}</p>
    {hint && <p className='glossa-reader-muted max-w-56 text-sm leading-relaxed'>{hint}</p>}
    {action && <div className='mt-2'>{action}</div>}
  </div>
);

export default EmptyState;
