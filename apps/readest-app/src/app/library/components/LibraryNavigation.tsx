import { useEffect, useRef, useState } from 'react';
import {
  BookSeries,
  BookCollection,
  LibraryBig,
  Tags,
  Users,
  Layers,
  ChevronDown,
  ChevronRight,
} from '@/components/GlossaIcons';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useLibraryStore } from '@/store/libraryStore';
import ApplicationSettingsButton from '@/components/settings/ApplicationSettingsButton';
import { LibraryGroupByType } from '@/types/settings';
import { navigateToLibrary } from '@/utils/nav';
import { md5Fingerprint } from '@/utils/md5';
import { ensureLibraryGroupByType, getLibraryCategoryLabel } from '../utils/libraryUtils';
import {
  folderLabel,
  folderParent,
  folderDepth,
  orderedFolderPaths,
  moveToFolder,
  MAX_FOLDER_DEPTH,
} from '../utils/libraryFolders';
import { LIBRARY_ITEMS_MIME, readLibraryItems } from '../utils/libraryDragDrop';
import { useLibraryFolders } from '../hooks/useLibraryFolders';
import { useFolderDrag, type FolderDrop } from '../hooks/useFolderDrag';
import FolderNameEditor from './FolderNameEditor';
import FolderDeleteDialog from './FolderDeleteDialog';
import BookContextMenuPopup, { type BookContextMenuItem } from './BookContextMenuPopup';

export default function LibraryNavigation({ onNavigate }: { onNavigate: () => void }) {
  const _ = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { settings } = useSettingsStore();
  const { library } = useLibraryStore();
  const folders = useLibraryFolders();
  const navRef = useRef<HTMLElement>(null);
  const savedFocus = useRef<string | null>(null);
  const [editing, setEditing] = useState<{ path?: string; parent: string } | null>(null);
  const [menu, setMenu] = useState<{ path: string; x: number; y: number; moving?: boolean } | null>(
    null,
  );
  const [deleting, setDeleting] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [focusPath, setFocusPath] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(new Set<string>());
  const collapsedBeforeDrag = useRef<Set<string> | null>(null);
  const groupBy = ensureLibraryGroupByType(searchParams?.get('groupBy'), settings.libraryGroupBy);
  const groupId = groupBy === LibraryGroupByType.Group ? searchParams?.get('group') : '';
  const current = folders.paths.find((path) => md5Fingerprint(path) === groupId) ?? '';
  const paths = orderedFolderPaths(folders.paths);
  const visible = paths.filter(
    (p) => !paths.some((a) => collapsed.has(a) && p.startsWith(a + '/')),
  );
  const navigate = (category: LibraryGroupByType, path = '') => {
    const params = new URLSearchParams(searchParams?.toString());
    params.set('groupBy', category);
    params.set('group', path ? md5Fingerprint(path) : '');
    onNavigate();
    navigateToLibrary(router, params.toString());
  };
  const seenRevision = useRef(folders.revision);
  useEffect(() => {
    if (seenRevision.current === folders.revision) return;
    seenRevision.current = folders.revision;
    const moved = [...(folders.replacements ?? [])].find(
      ([path]) => md5Fingerprint(path) === groupId,
    );
    if (moved) navigate(LibraryGroupByType.Group, moved[1]);
    setCollapsed(
      (previous) => new Set([...previous].map((p) => folders.replacements?.get(p) ?? p)),
    );
    // Only redirect the group still active when its save completes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folders.revision]);
  useEffect(() => {
    if (focusPath === null || editing) return;
    [...(navRef.current?.querySelectorAll<HTMLButtonElement>('[data-library-folder-path]') ?? [])]
      .find((el) => el.dataset['libraryFolderPath'] === focusPath)
      ?.focus();
    setFocusPath(null);
  }, [focusPath, editing]);
  const expand = (path: string) =>
    setCollapsed((previous) => {
      const next = new Set(previous);
      for (let parent = path; parent; parent = folderParent(parent)) next.delete(parent);
      return next.size === previous.size ? previous : next;
    });
  const begin = (parent: string, path?: string) => {
    if (folders.busy) return;
    folders.clearError();
    expand(parent);
    setEditing({ parent, path });
  };
  const finishEdit = (restoreFocus = true) => {
    const path = savedFocus.current ?? editing?.path ?? editing?.parent ?? '';
    savedFocus.current = null;
    setEditing(null);
    if (restoreFocus) setFocusPath(path);
  };
  const save = async (label: string) => {
    if (!editing) return false;
    if (editing.path !== undefined) {
      if (!(await folders.rename(editing.path, label))) return false;
      savedFocus.current = [folderParent(editing.path), label.trim() || folderLabel(editing.path)]
        .filter(Boolean)
        .join('/');
    } else {
      const path = await folders.create(editing.parent, label);
      if (!path) return false;
      savedFocus.current = path;
    }
    return true;
  };
  const moveBranch = async (path: string, target: FolderDrop) => {
    if (folders.busy) return false;
    const saved =
      target.edge === 'inside'
        ? await folders.move([md5Fingerprint(path)], target.path)
        : await folders.place(path, target.path, target.edge);
    if (saved) {
      expand(target.edge === 'inside' ? target.path : folderParent(target.path));
      setFocusPath(folders.resolvePath(path));
    }
    return saved;
  };
  const { drag, start, suppressClick } = useFolderDrag({
    root: navRef,
    disabled: folders.busy || !!editing || !!deleting,
    onMenu: (path, position) => setMenu(path === null ? null : { path, ...position }),
    onDrop: moveBranch,
    onExpand: expand,
    onStart: () => {
      collapsedBeforeDrag.current = new Set(collapsed);
    },
    onFinish: (saved) => {
      if (!saved && collapsedBeforeDrag.current) setCollapsed(collapsedBeforeDrag.current);
      collapsedBeforeDrag.current = null;
    },
  });
  let dragError = '';
  if (drag?.target) {
    try {
      moveToFolder(
        [],
        paths,
        [md5Fingerprint(drag.path)],
        drag.target.edge === 'inside' ? drag.target.path : folderParent(drag.target.path),
      );
      if (drag.path === drag.target.path || drag.target.path.startsWith(drag.path + '/'))
        throw new Error('Cannot move a folder into itself');
    } catch (err) {
      dragError = err instanceof Error ? _(err.message) : '';
    }
  }
  const dropProps = (path: string) => ({
    'data-library-folder-path': path,
    'data-folder-drop': path,
    'data-drop-target':
      dropTarget === path ||
      (drag?.target?.path === path && drag.target.edge === 'inside' && !dragError)
        ? ''
        : undefined,
    'data-drop-edge':
      drag?.target?.path === path && drag.target.edge !== 'inside' && !dragError
        ? drag.target.edge
        : undefined,
    onDragOver: (event: React.DragEvent) => {
      if (!event.dataTransfer.types.includes(LIBRARY_ITEMS_MIME)) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = 'move';
      setDropTarget(path);
    },
    onDragLeave: () => setDropTarget(null),
    onDrop: (event: React.DragEvent) => {
      if (!event.dataTransfer.types.includes(LIBRARY_ITEMS_MIME)) return;
      event.preventDefault();
      event.stopPropagation();
      setDropTarget(null);
      const ids = readLibraryItems(event.dataTransfer);
      if (ids.length && !folders.busy) void folders.move(ids, path);
    },
  });
  const openMenu = (path: string, element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    setMenu({ path, x: rect.left, y: rect.bottom });
  };
  const remove = (path: string) => {
    if (
      paths.some((p) => p.startsWith(path + '/')) ||
      library.some((b) => !b.deletedAt && b.groupName === path)
    )
      setDeleting(path);
    else void folders.remove(path);
  };
  const menuItems: BookContextMenuItem[] = menu?.moving
    ? [
        {
          text: _('My Groups'),
          action: () => void moveBranch(menu.path, { path: '', edge: 'inside' }),
        },
        ...paths
          .filter((p) => p !== menu.path && !p.startsWith(menu.path + '/'))
          .map((p) => {
            let disabled = folders.busy;
            try {
              moveToFolder([], paths, [md5Fingerprint(menu.path)], p);
            } catch {
              disabled = true;
            }
            return {
              text: p,
              disabled,
              action: () => void moveBranch(menu.path, { path: p, edge: 'inside' }),
            };
          }),
      ]
    : [
        ...(menu?.path
          ? [
              {
                text: _('Rename group'),
                disabled: folders.busy,
                action: () => begin(folderParent(menu.path), menu.path),
              },
              ...(folderDepth(menu.path) < MAX_FOLDER_DEPTH
                ? [
                    {
                      text: _('New subgroup'),
                      disabled: folders.busy,
                      action: () => begin(menu.path),
                    },
                  ]
                : []),
              {
                text: _('Move to…'),
                disabled: folders.busy,
                action: () => setMenu({ ...menu, moving: true }),
              },
              { text: _('Delete group'), disabled: folders.busy, action: () => remove(menu.path) },
            ]
          : [{ text: _('New group'), disabled: folders.busy, action: () => begin('') }]),
        ...(folders.canUndo
          ? [
              {
                text: _('Undo'),
                disabled: folders.busy,
                action: () => void folders.undo(),
              },
            ]
          : []),
      ];
  const editor = editing && (
    <FolderNameEditor
      initialName={editing.path ? folderLabel(editing.path) : ''}
      onSave={save}
      onCancel={finishEdit}
    />
  );
  const editRow = (depth: number) => (
    <div className='glossa-library-folder-edit-row' style={{ paddingInlineStart: depth * 14 + 11 }}>
      <span className='glossa-folder-expander-space' />
      <BookCollection size={18} aria-hidden='true' />
      {editor}
    </div>
  );
  return (
    <nav
      ref={navRef}
      id='library-navigation'
      className='glossa-library-navigation'
      aria-label={_('Library')}
      onKeyDown={(event) => {
        if ((event.target as HTMLElement).closest('form')) return;
        if (
          (event.metaKey || event.ctrlKey) &&
          event.shiftKey &&
          event.key.toLowerCase() === 'n' &&
          !folders.busy
        ) {
          event.preventDefault();
          begin('');
          return;
        }
        if (
          (event.metaKey || event.ctrlKey) &&
          event.key.toLowerCase() === 'z' &&
          !event.shiftKey &&
          folders.canUndo
        ) {
          event.preventDefault();
          void folders.undo();
          return;
        }
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || event.altKey) return;
        const buttons = [
          ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
            'button[data-nav-focus]:not(:disabled), .glossa-library-navigation-footer button',
          ),
        ];
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if (index < 0) return;
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? buttons.length - 1
              : Math.max(
                  0,
                  Math.min(buttons.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)),
                );
        buttons[next]?.focus();
        event.preventDefault();
      }}
    >
      <div className='glossa-library-navigation-categories'>
        <section className='glossa-library-navigation-section' aria-label={_('Library')}>
          <h2>{_('Library')}</h2>
          <button
            type='button'
            data-nav-focus
            aria-current={groupBy === LibraryGroupByType.None ? 'page' : undefined}
            {...dropProps('')}
            onClick={() => navigate(LibraryGroupByType.None)}
          >
            <LibraryBig size={18} aria-hidden='true' />
            <span>{_('All Books')}</span>
          </button>
        </section>
        <section
          className='glossa-library-navigation-section glossa-library-my-folders'
          aria-label={_('My Groups')}
          onContextMenu={(event) => {
            if ((event.target as HTMLElement).closest('form')) return;
            event.preventDefault();
            const row = (event.target as HTMLElement).closest<HTMLElement>('[data-folder-row]');
            setMenu({ path: row?.dataset['folderRow'] ?? '', x: event.clientX, y: event.clientY });
          }}
        >
          <h2>
            <button
              type='button'
              className='glossa-library-folders-heading'
              data-nav-focus
              aria-haspopup='menu'
              {...dropProps('')}
              onClick={(event) => openMenu('', event.currentTarget)}
              onKeyDown={(event) => {
                if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
                  event.preventDefault();
                  openMenu('', event.currentTarget);
                }
              }}
            >
              {_('My Groups')}
            </button>
          </h2>
          {visible.map((path) => {
            const children = paths.some((p) => folderParent(p) === path);
            const depth = folderDepth(path) - 1;
            return (
              <div
                key={path}
                data-folder-row={path}
                className='glossa-library-folder-row'
                data-dragging={drag?.path === path ? '' : undefined}
                style={{ paddingInlineStart: depth * 14 }}
              >
                {children ? (
                  <button
                    type='button'
                    data-expander
                    className='glossa-folder-expander'
                    aria-label={_(collapsed.has(path) ? 'Expand group' : 'Collapse group')}
                    aria-expanded={!collapsed.has(path)}
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
                      <ChevronRight size={12} className='rtl:rotate-180' />
                    ) : (
                      <ChevronDown size={12} />
                    )}
                  </button>
                ) : (
                  <span className='glossa-folder-expander-space' />
                )}
                {editing?.path === path ? (
                  <div
                    className='glossa-library-folder-edit-content'
                    data-current={
                      groupBy === LibraryGroupByType.Group && current === path ? 'page' : undefined
                    }
                  >
                    <BookCollection size={18} aria-hidden='true' />
                    {editor}
                  </div>
                ) : (
                  <button
                    type='button'
                    className='glossa-library-folder-link'
                    data-nav-focus
                    aria-label={path}
                    title={path}
                    aria-haspopup='menu'
                    aria-current={
                      groupBy === LibraryGroupByType.Group && current === path ? 'page' : undefined
                    }
                    {...dropProps(path)}
                    onPointerDown={(event) => start(event, path)}
                    onDragStart={(event) => event.preventDefault()}
                    onClick={(event) => {
                      if (suppressClick.current) {
                        event.preventDefault();
                        return;
                      }
                      navigate(LibraryGroupByType.Group, path);
                    }}
                    onDoubleClick={() => begin(folderParent(path), path)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setMenu({ path, x: event.clientX, y: event.clientY });
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'F2') {
                        event.preventDefault();
                        begin(folderParent(path), path);
                      } else if (
                        event.key === 'ContextMenu' ||
                        (event.shiftKey && event.key === 'F10')
                      ) {
                        event.preventDefault();
                        openMenu(path, event.currentTarget);
                      } else if (event.altKey && event.key === 'ArrowLeft' && folderParent(path)) {
                        event.preventDefault();
                        void moveBranch(path, {
                          path: folderParent(path),
                          edge: 'after',
                        });
                      } else if (event.altKey && event.key === 'ArrowRight') {
                        const siblings = paths.filter(
                          (p) => folderParent(p) === folderParent(path),
                        );
                        const previous = siblings[siblings.indexOf(path) - 1];
                        if (previous) {
                          event.preventDefault();
                          void moveBranch(path, { path: previous, edge: 'inside' });
                        }
                      } else if (!event.altKey && event.key === 'ArrowLeft') {
                        event.preventDefault();
                        if (children && !collapsed.has(path))
                          setCollapsed((p) => new Set(p).add(path));
                        else setFocusPath(folderParent(path));
                      } else if (!event.altKey && event.key === 'ArrowRight' && children) {
                        event.preventDefault();
                        if (collapsed.has(path)) expand(path);
                        else setFocusPath(paths.find((p) => folderParent(p) === path) ?? path);
                      }
                    }}
                  >
                    <BookCollection size={18} aria-hidden='true' />
                    <span>{folderLabel(path)}</span>
                  </button>
                )}
                {editing?.path === undefined && editing?.parent === path && editRow(1)}
              </div>
            );
          })}
          {editing && editing.path === undefined && !editing.parent && editRow(0)}
          <div className='glossa-folder-root-drop' {...dropProps('')} aria-hidden='true' />
          {folders.error && (
            <p role='alert' className='glossa-folder-error'>
              {folders.error}
            </p>
          )}
        </section>
        <section className='glossa-library-navigation-section' aria-label={_('Browse')}>
          <h2>{_('Browse')}</h2>
          {[
            { value: LibraryGroupByType.Author, Icon: Users },
            { value: LibraryGroupByType.Series, Icon: BookSeries },
            { value: LibraryGroupByType.Tag, Icon: Tags },
            { value: LibraryGroupByType.Subject, Icon: Layers },
          ].map(({ value, Icon }) => (
            <button
              key={value}
              type='button'
              data-nav-focus
              aria-current={groupBy === value ? 'page' : undefined}
              onClick={() => navigate(value)}
            >
              <Icon size={18} aria-hidden='true' />
              <span>{_(getLibraryCategoryLabel(value))}</span>
            </button>
          ))}
        </section>
      </div>
      {menu && (
        <BookContextMenuPopup
          key={menu.moving ? 'move' : 'actions'}
          position={menu}
          items={menuItems}
          onClose={() => {
            setMenu(null);
            if (!drag) setFocusPath(menu.path);
          }}
        />
      )}
      {deleting !== null && (
        <FolderDeleteDialog
          path={deleting}
          onConfirm={() => folders.remove(deleting)}
          onClose={() => {
            setFocusPath(folderParent(deleting));
            setDeleting(null);
          }}
        />
      )}
      {drag && (
        <div
          className='glossa-folder-drag-preview'
          aria-hidden='true'
          style={{ left: drag.x + 14, top: drag.y + 14 }}
        >
          {dragError || folderLabel(drag.path)}
        </div>
      )}
      <div className='glossa-library-navigation-footer'>
        <ApplicationSettingsButton variant='navigation' />
      </div>
    </nav>
  );
}
