import FolderNameEditor from './FolderNameEditor';

export default function FolderToolbar({
  parent,
  create,
  error,
  clearError,
  active = false,
  onClose,
}: {
  parent: string;
  create: (parent: string, name: string) => Promise<string | undefined>;
  busy: boolean;
  error: string;
  clearError: () => void;
  active?: boolean;
  onClose?: (restoreFocus?: boolean) => void;
}) {
  if (!active && !error) return null;
  return (
    <div className='glossa-folder-toolbar'>
      {active && (
        <FolderNameEditor
          onSave={async (name) => !!(await create(parent, name))}
          onCancel={(restoreFocus) => {
            onClose?.(restoreFocus);
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
