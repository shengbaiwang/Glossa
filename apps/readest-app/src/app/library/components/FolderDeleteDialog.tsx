import { useEffect, useRef } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import ModalPortal from '@/components/ModalPortal';
import Alert from '@/components/Alert';
import { folderLabel } from '../utils/libraryFolders';

export default function FolderDeleteDialog({
  path,
  onConfirm,
  onClose,
}: {
  path: string;
  onConfirm: () => Promise<boolean>;
  onClose: () => void;
}) {
  const _ = useTranslation();
  const confirm = useRef(false);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <ModalPortal>
      <Alert
        title={_('Delete “{{name}}”?', { name: folderLabel(path) })}
        message={_('Books and subgroups move up one level. Reading data is kept.')}
        confirmLabel={_('Delete group')}
        onCancel={() => {
          if (!confirm.current) close.current();
        }}
        onConfirm={() => {
          if (confirm.current) return;
          confirm.current = true;
          void onConfirm().finally(() => close.current());
        }}
      />
    </ModalPortal>
  );
}
