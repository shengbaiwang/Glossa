import { useEffect, useState } from 'react';
import { FolderPlus } from '@/components/GlossaIcons';
import { useTranslation } from '@/hooks/useTranslation';
import FolderNameEditor from './FolderNameEditor';

export default function FolderToolbar({
  parent,
  create,
  busy,
  error,
  clearError,
}: {
  parent: string;
  create: (parent: string, name: string) => Promise<string | undefined>;
  busy: boolean;
  error: string;
  clearError: () => void;
}) {
  const _ = useTranslation();
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    setCreating(false);
  }, [parent]);
  return (
    <div className='glossa-folder-toolbar'>
      {!parent.includes('/') && !creating && (
        <button
          type='button'
          className='glossa-folder-action'
          disabled={busy}
          onClick={() => {
            clearError();
            setCreating(true);
          }}
        >
          <FolderPlus size={18} aria-hidden='true' />
          {_('New Folder')}
        </button>
      )}
      {creating && (
        <FolderNameEditor
          onSave={async (name) => !!(await create(parent, name))}
          onCancel={() => {
            setCreating(false);
            clearError();
          }}
        />
      )}
      {error && (
        <p className='glossa-folder-error' role='alert'>
          {error}
        </p>
      )}
    </div>
  );
}
