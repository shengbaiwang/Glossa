import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Folder, FolderPlus, X } from '@/components/GlossaIcons';
import { Book } from '@/types/book';
import { useTranslation } from '@/hooks/useTranslation';
import { useLibraryFolders } from '../hooks/useLibraryFolders';
import { folderLabel, folderParent } from '../utils/libraryFolders';
import FolderNameEditor from './FolderNameEditor';

interface GroupingModalProps {
  libraryBooks: Book[];
  selectedBooks: string[];
  parentGroupName: string;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function GroupingModal({
  selectedBooks,
  parentGroupName,
  onCancel,
  onConfirm,
}: GroupingModalProps) {
  const _ = useTranslation();
  const folders = useLibraryFolders();
  const [target, setTarget] = useState(parentGroupName);
  const [creating, setCreating] = useState(false);
  const [collapsed, setCollapsed] = useState(new Set<string>());
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus();
    return () => previous?.focus();
  }, []);
  const paths = [...folders.paths].sort((a, b) => a.localeCompare(b));
  const visiblePaths = paths.filter(
    (path) => !paths.some((parent) => path.startsWith(`${parent}/`) && collapsed.has(parent)),
  );
  const cancel = () => {
    if (!folders.busy) onCancel();
  };
  const choose = (path: string) => {
    setTarget(path);
    setCreating(false);
    folders.clearError();
  };
  return (
    <div
      ref={dialog}
      className='modal modal-open'
      role='dialog'
      aria-modal='true'
      aria-label={_('Move to Folder')}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !creating) {
          event.preventDefault();
          cancel();
        }
        if (event.key === 'Tab') {
          const controls = [
            ...(dialog.current?.querySelectorAll<HTMLElement>(
              'button:not(:disabled), input:not(:disabled)',
            ) ?? []),
          ];
          const first = controls[0],
            last = controls[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          }
          if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }
      }}
    >
      <div className='modal-box glossa-folder-picker'>
        <header>
          <h2>{_('Move to Folder')}</h2>
          <button
            type='button'
            className='glossa-icon-button'
            aria-label={_('Close')}
            onClick={cancel}
            disabled={folders.busy}
          >
            <X size={18} />
          </button>
        </header>
        <div className='glossa-folder-tree' aria-label={_('Folders')}>
          {['', ...visiblePaths].map((path) => {
            const children = paths.some((p) => folderParent(p) === path);
            const depth = path ? path.split('/').length : 0;
            return (
              <div key={path}>
                <div
                  className='glossa-folder-tree-row'
                  style={{ paddingInlineStart: `${Math.max(0, depth - 1) * 20}px` }}
                >
                  {path && children ? (
                    <button
                      type='button'
                      className='glossa-icon-button'
                      aria-label={_(collapsed.has(path) ? 'Expand folder' : 'Collapse folder')}
                      onClick={() =>
                        setCollapsed((previous) => {
                          const next = new Set(previous);
                          if (next.has(path)) next.delete(path);
                          else next.add(path);
                          return next;
                        })
                      }
                    >
                      {collapsed.has(path) ? (
                        <ChevronRight size={14} className='rtl:rotate-180' />
                      ) : (
                        <ChevronDown size={14} />
                      )}
                    </button>
                  ) : (
                    <span className='glossa-folder-tree-spacer' />
                  )}
                  <button
                    type='button'
                    className='glossa-folder-destination'
                    aria-pressed={target === path}
                    disabled={folders.busy}
                    onClick={() => choose(path)}
                  >
                    <Folder size={18} aria-hidden='true' />
                    <span>{path ? folderLabel(path) : _('All Books')}</span>
                    {target === path && <Check size={16} aria-hidden='true' />}
                  </button>
                </div>
                {creating && target === path && (
                  <div
                    className='glossa-folder-draft'
                    style={{ paddingInlineStart: `${depth * 20 + 30}px` }}
                  >
                    <FolderNameEditor
                      onCancel={() => {
                        setCreating(false);
                        folders.clearError();
                      }}
                      onSave={async (name) => {
                        const created = await folders.create(target, name);
                        if (!created) return false;
                        setCollapsed((previous) => {
                          const next = new Set(previous);
                          next.delete(target);
                          return next;
                        });
                        setTarget(created);
                        setCreating(false);
                        return true;
                      }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {folders.error && (
          <p className='glossa-folder-error' role='alert'>
            {folders.error}
          </p>
        )}
        <footer>
          <button
            type='button'
            className='glossa-folder-action'
            disabled={folders.busy || target.includes('/') || creating}
            onClick={() => {
              folders.clearError();
              setCreating(true);
            }}
          >
            <FolderPlus size={18} aria-hidden='true' />
            {_('New Folder')}
          </button>
          <div>
            <button
              type='button'
              className='btn btn-ghost'
              disabled={folders.busy}
              onClick={cancel}
            >
              {_('Cancel')}
            </button>
            <button
              type='button'
              className='btn btn-primary'
              disabled={folders.busy || creating}
              onClick={async () => {
                if (await folders.move(selectedBooks, target)) onConfirm();
              }}
            >
              {_('Move')}
            </button>
          </div>
        </footer>
      </div>
      <div className='modal-backdrop' onClick={cancel} />
    </div>
  );
}
