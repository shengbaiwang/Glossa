import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight, BookCollection, X } from '@/components/GlossaIcons';
import { Book } from '@/types/book';
import { useTranslation } from '@/hooks/useTranslation';
import { useLibraryFolders } from '../hooks/useLibraryFolders';
import {
  folderLabel,
  folderParent,
  folderDepth,
  orderedFolderPaths,
  moveToFolder,
  MAX_FOLDER_DEPTH,
} from '../utils/libraryFolders';
import { useLibraryStore } from '@/store/libraryStore';
import FolderNameEditor from './FolderNameEditor';
import BookContextMenuPopup from './BookContextMenuPopup';

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
  const chosenTarget = useRef(parentGroupName);
  const [creating, setCreating] = useState(false);
  const [collapsed, setCollapsed] = useState(new Set<string>());
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus();
    return () => previous?.focus();
  }, []);
  const paths = orderedFolderPaths(folders.paths);
  const visiblePaths = paths.filter(
    (path) => !paths.some((parent) => path.startsWith(`${parent}/`) && collapsed.has(parent)),
  );
  const cancel = () => {
    if (!folders.busy) onCancel();
  };
  const choose = (path: string) => {
    chosenTarget.current = path;
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
      aria-label={_('Move to group')}
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
          <h2>
            <button
              type='button'
              className='glossa-folder-heading-action'
              aria-haspopup='menu'
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                setMenu({ x: rect.left, y: rect.bottom });
              }}
            >
              {_('Move to group')}
            </button>
          </h2>
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
        <div className='glossa-folder-tree' aria-label={_('Groups')}>
          {['', ...visiblePaths].map((path) => {
            const children = paths.some((p) => folderParent(p) === path);
            const depth = path ? path.split('/').length : 0;
            let unavailable = false;
            try {
              moveToFolder(useLibraryStore.getState().library, paths, selectedBooks, path);
            } catch {
              unavailable = true;
            }
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
                      aria-label={_(collapsed.has(path) ? 'Expand group' : 'Collapse group')}
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
                    disabled={unavailable}
                    onClick={() => choose(path)}
                  >
                    <BookCollection size={18} aria-hidden='true' />
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
                        if (chosenTarget.current === target) {
                          chosenTarget.current = created;
                          setTarget(created);
                        }
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
      {menu && (
        <BookContextMenuPopup
          position={menu}
          onClose={() => setMenu(null)}
          items={[
            {
              text: _(target ? 'New subgroup' : 'New group'),
              disabled: folders.busy || folderDepth(target) >= MAX_FOLDER_DEPTH || creating,
              action: () => {
                folders.clearError();
                setCreating(true);
              },
            },
          ]}
        />
      )}
      <div className='modal-backdrop' onClick={cancel} />
    </div>
  );
}
