import { useEffect, type ReactNode } from 'react';
import Dialog from '@/components/Dialog';

/** One compact surface for every library import, including narrow touch screens. */
export default function ImportDialog({
  title,
  onClose,
  children,
  className = '',
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      const target =
        previous?.isConnected && previous !== document.body
          ? previous
          : document.querySelector<HTMLElement>('.glossa-library-import');
      target?.focus();
    };
  }, []);
  return (
    <Dialog
      isOpen
      title={title}
      snapHeight={0.5}
      onClose={onClose}
      boxClassName={`glossa-import-dialog ${className}`}
      contentClassName='!px-6 !py-2'
    >
      {children}
    </Dialog>
  );
}
