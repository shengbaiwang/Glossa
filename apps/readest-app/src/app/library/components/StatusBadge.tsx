import clsx from 'clsx';
import type { ReadingStatus } from '@/types/book';

interface StatusBadgeProps {
  status?: ReadingStatus;
  children: React.ReactNode;
  className?: string;
}

const StatusBadge: React.FC<StatusBadgeProps> = ({ status, children, className }) => {
  if (status !== 'finished' && status !== 'unread' && status !== 'abandoned') return null;

  return (
    <span
      className={clsx('glossa-status-badge', `status-badge-${status}`, className)}
      role='status'
    >
      {children}
    </span>
  );
};

export default StatusBadge;
