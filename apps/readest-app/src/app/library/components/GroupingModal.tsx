import { useLibraryBookEdits } from '../hooks/useLibraryBookEdits';
import { SPACE_LABELS } from '@/utils/readingSpaces';
import { md5Fingerprint } from '@/utils/md5';
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
  libraryBooks,
  selectedBooks,
  parentGroupName,
  onCancel,
  onConfirm,
}: GroupingModalProps) {
  const _ = useTranslation();
  const folders = useLibraryFolders();
  const edits = useLibraryBookEdits();
  const [spaceBusy, setSpaceBusy] = useState(false);
  const selectedPaths = folders.paths.filter((p) => selectedBooks.includes(md5Fingerprint(p)));
  const spaceBooks = libraryBooks.filter(
    (b) =>
      !b.deletedAt &&
      (selectedBooks.includes(b.hash) ||
        selectedPaths.some((p) => b.groupName === p || b.groupName?.startsWith(p + '/'))),
  );
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
    if (!folders.busy && !spaceBusy) onCancel();
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
              'button:not(:disabled), input:not(:disabled), select:not(:disabled)',
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
            disabled={folders.busy || spaceBusy}
          >
            <X size={18} />
          </button>
        </header>
        {spaceBooks.length > 0 && (
          <label className='flex items-center gap-3 px-2 py-2'>
            <span>{_('Reading space')}</span>
            <select
              className='select select-sm eink-bordered'
              aria-label={_('Assign reading space')}
              value=''
              disabled={spaceBusy || folders.busy}
              onChange={async (event) => {
                const value = event.target.value;
                if (!value) return;
                setSpaceBusy(true);
                try {
                  if (
                    await edits.apply(
                      spaceBooks,
                      'readingSpaces',
                      value === 'both' ? ['leisure', 'academic'] : [value],
                    )
                  )
                    onConfirm();
                } finally {
                  setSpaceBusy(false);
                }
              }}
            >
              <option value=''>{_('Choose space…')}</option>
              <option value='leisure'>{_(SPACE_LABELS.leisure)}</option>
              <option value='academic'>{_(SPACE_LABELS.academic)}</option>
              <option value='both'>{_('Both spaces')}</option>
            </select>
          </label>
        )}
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
              disabled={folders.busy || spaceBusy}
              onClick={cancel}
            >
              {_('Cancel')}
            </button>
            <button
              type='button'
              className='btn btn-primary'
              disabled={folders.busy || spaceBusy || creating}
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
