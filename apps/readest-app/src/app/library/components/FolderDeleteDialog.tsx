import { useTranslation } from '@/hooks/useTranslation';
import ModalPortal from '@/components/ModalPortal';
import DeleteConfirmAlert from '@/components/DeleteConfirmAlert';
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
  return (
    <ModalPortal>
      <DeleteConfirmAlert
        destructive
        title={_('Delete “{{name}}”?', { name: folderLabel(path) })}
        message={_('Books and subgroups move up one level. Reading data is kept.')}
        books={[{ hash: path, title: path }]}
        confirmLabel={_('Delete group')}
        onCancel={onClose}
        onConfirm={async () => {
          if (!(await onConfirm())) throw new Error('Group removal failed');
          onClose();
        }}
      />
    </ModalPortal>
  );
}
