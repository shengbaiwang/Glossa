import { useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import ModalPortal from '@/components/ModalPortal';
import DeleteConfirmAlert from '@/components/DeleteConfirmAlert';
import { folderLabel } from '../utils/libraryFolders';

export default function FolderDeleteDialog({
  paths,
  books = [],
  containedBookCount = 0,
  scope,
  errorMessage,
  onConfirm,
  onClose,
  onStop,
}: {
  paths: string[];
  books?: { hash: string; title: string }[];
  containedBookCount?: number;
  scope?: string;
  errorMessage?: string;
  onConfirm: (includeBooks: boolean) => Promise<boolean>;
  onClose: () => void;
  onStop?: () => void;
}) {
  const _ = useTranslation();
  const [includeBooks, setIncludeBooks] = useState(false);
  return (
    <ModalPortal>
      <DeleteConfirmAlert
        destructive
        className='glossa-group-removal-dialog'
        title={
          books.length
            ? _('Delete selection?')
            : paths.length === 1
              ? _('Delete group “{{name}}”?', { name: folderLabel(paths[0]!) })
              : _('Delete selected groups?')
        }
        message={
          includeBooks
            ? _('Files move to Recently Deleted and can be restored.')
            : books.length
              ? _(
                  'Selected files move to Recently Deleted. Other files and subgroups move up one level.',
                )
              : _('Files and subgroups move up one level.')
        }
        books={[
          ...paths.map((path) => ({ hash: `group:${path}`, title: path.replaceAll('/', ' › ') })),
          ...books,
        ]}
        footer={
          <p className='glossa-removal-caption'>
            {_('Reading data and external originals are kept.')}
            {scope && <> {scope}</>}
          </p>
        }
        errorMessage={errorMessage}
        confirmLabel={
          includeBooks || books.length
            ? paths.length === 1
              ? _('Delete group and files')
              : _('Delete groups and files')
            : paths.length === 1
              ? _('Delete group')
              : _('Delete groups')
        }
        onCancel={onClose}
        onStop={onStop}
        onConfirm={async () => {
          if (!(await onConfirm(includeBooks))) throw new Error('Group removal failed');
          onClose();
        }}
      >
        {!!containedBookCount && (
          <label className='glossa-group-removal-option'>
            <input
              type='checkbox'
              className='checkbox checkbox-sm'
              checked={includeBooks}
              onChange={(event) => setIncludeBooks(event.target.checked)}
            />
            <span className='text-sm'>
              {books.length
                ? _('Also delete remaining group files (including subgroups, {{count}} total)', {
                    count: containedBookCount,
                  })
                : _('Also delete files (including subgroups, {{count}} total)', {
                    count: containedBookCount,
                  })}
            </span>
          </label>
        )}
      </DeleteConfirmAlert>
    </ModalPortal>
  );
}
