import { useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  Folder,
  LibraryBig,
  Tags,
  Users,
  Layers,
  Plus,
  Pencil,
} from '@/components/GlossaIcons';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import ApplicationSettingsButton from '@/components/settings/ApplicationSettingsButton';
import { LibraryGroupByType } from '@/types/settings';
import { navigateToLibrary } from '@/utils/nav';
import { md5Fingerprint } from '@/utils/md5';
import { ensureLibraryGroupByType, getLibraryCategoryLabel } from '../utils/libraryUtils';
import { folderLabel, folderParent } from '../utils/libraryFolders';
import { LIBRARY_ITEMS_MIME, readLibraryItems } from '../utils/libraryDragDrop';
import { useLibraryFolders } from '../hooks/useLibraryFolders';
import FolderNameEditor from './FolderNameEditor';

export default function LibraryNavigation({ onNavigate }: { onNavigate: () => void }) {
  const _ = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { settings } = useSettingsStore();
  const folders = useLibraryFolders();
  const navRef = useRef<HTMLElement>(null);
  const savedFocus = useRef<string | null>(null);
  const [editing, setEditing] = useState<{ path?: string; parent: string } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [focusPath, setFocusPath] = useState<string | null>(null);
  const groupBy = ensureLibraryGroupByType(searchParams?.get('groupBy'), settings.libraryGroupBy);
  const current =
    groupBy === LibraryGroupByType.Group
      ? (folders.paths.find((path) => md5Fingerprint(path) === searchParams?.get('group')) ?? '')
      : '';
  const paths = [...folders.paths].sort((a, b) => a.localeCompare(b));

  const navigate = (category: LibraryGroupByType, path = '') => {
    const params = new URLSearchParams(searchParams?.toString());
    params.set('groupBy', category);
    params.set('group', path ? md5Fingerprint(path) : '');
    onNavigate();
    navigateToLibrary(router, params.toString());
  };
  useEffect(() => {
    if (focusPath === null || editing) return;
    const button = Array.from(
      navRef.current?.querySelectorAll<HTMLButtonElement>('[data-library-folder-path]') ?? [],
    ).find((el) => el.dataset['libraryFolderPath'] === focusPath);
    button?.focus();
    setFocusPath(null);
  }, [focusPath, editing]);
  const finishEdit = () => {
    const path = savedFocus.current ?? editing?.path ?? editing?.parent ?? '';
    savedFocus.current = null;
    setEditing(null);
    setFocusPath(path);
  };
  const save = async (label: string) => {
    if (!editing) return false;
    if (editing.path !== undefined) {
      const path = editing.path;
      if (!(await folders.rename(path, label))) return false;
      const next = folderParent(path) ? `${folderParent(path)}/${label.trim()}` : label.trim();
      if (current === path || current.startsWith(`${path}/`))
        navigate(LibraryGroupByType.Group, next + current.slice(path.length));
      savedFocus.current = next;
    } else {
      const path = await folders.create(editing.parent, label);
      if (!path) return false;
      savedFocus.current = path;
    }
    return true;
  };
  const drop = async (event: React.DragEvent, destination: string) => {
    if (!event.dataTransfer.types.includes(LIBRARY_ITEMS_MIME)) return;
    event.preventDefault();
    event.stopPropagation();
    setDropTarget(null);
    const ids = readLibraryItems(event.dataTransfer);
    if (!ids.length || folders.busy) return;
    const activeMoved = paths.find(
      (path) =>
        ids.includes(md5Fingerprint(path)) && (current === path || current.startsWith(`${path}/`)),
    );
    if (await folders.move(ids, destination)) {
      if (activeMoved) {
        const next = destination
          ? `${destination}/${folderLabel(activeMoved)}`
          : folderLabel(activeMoved);
        navigate(LibraryGroupByType.Group, next + current.slice(activeMoved.length));
      }
    }
  };
  const dropProps = (path: string) => ({
    'data-library-folder-path': path,
    'data-drop-target': dropTarget === path ? '' : undefined,
    onDragOver: (event: React.DragEvent) => {
      if (!event.dataTransfer.types.includes(LIBRARY_ITEMS_MIME)) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = 'move';
      setDropTarget(path);
    },
    onDragLeave: () => setDropTarget(null),
    onDrop: (event: React.DragEvent) => void drop(event, path),
  });
  const editor = editing && (
    <FolderNameEditor
      initialName={editing.path ? folderLabel(editing.path) : ''}
      onSave={save}
      onCancel={finishEdit}
    />
  );

  return (
    <nav
      ref={navRef}
      id='library-navigation'
      className='glossa-library-navigation'
      aria-label={_('Library')}
      onKeyDown={(event) => {
        if (
          (event.target as HTMLElement).closest('form') ||
          !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)
        )
          return;
        const buttons = Array.from(
          event.currentTarget.querySelectorAll<HTMLButtonElement>(
            'button[data-nav-focus]:not(:disabled), .glossa-library-navigation-footer button',
          ),
        );
        const currentIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if (currentIndex < 0) return;
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? buttons.length - 1
              : Math.max(
                  0,
                  Math.min(buttons.length - 1, currentIndex + (event.key === 'ArrowDown' ? 1 : -1)),
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
            <BookOpen size={18} aria-hidden='true' />
            <span>{_('All Books')}</span>
          </button>
        </section>
        <section
          className='glossa-library-navigation-section glossa-library-my-folders'
          aria-label={_('My Groups')}
        >
          <h2>
            <button
              type='button'
              className='glossa-library-folders-heading'
              data-nav-focus
              aria-current={groupBy === LibraryGroupByType.Group && !current ? 'page' : undefined}
              {...dropProps('')}
              onClick={() => navigate(LibraryGroupByType.Group)}
            >
              {_('My Groups')}
            </button>
          </h2>
          {paths.map((path) => (
            <div
              key={path}
              className='glossa-library-folder-row'
              style={{ paddingInlineStart: `${Math.min(path.split('/').length - 1, 3) * 14}px` }}
            >
              {editing?.path === path ? (
                editor
              ) : (
                <>
                  <button
                    type='button'
                    className='glossa-library-folder-link'
                    data-nav-focus
                    aria-label={path}
                    title={path}
                    aria-current={
                      groupBy === LibraryGroupByType.Group && current === path ? 'page' : undefined
                    }
                    draggable={!folders.busy}
                    {...dropProps(path)}
                    onDragStart={(event) => {
                      event.dataTransfer.setData(
                        LIBRARY_ITEMS_MIME,
                        JSON.stringify([md5Fingerprint(path)]),
                      );
                      event.dataTransfer.effectAllowed = 'move';
                    }}
                    onDragEnd={() => setDropTarget(null)}
                    onClick={() => navigate(LibraryGroupByType.Group, path)}
                    onDoubleClick={() => {
                      folders.clearError();
                      setEditing({ path, parent: folderParent(path) });
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'F2') {
                        event.preventDefault();
                        folders.clearError();
                        setEditing({ path, parent: folderParent(path) });
                      }
                    }}
                  >
                    <Folder size={18} aria-hidden='true' />
                    <span>{folderLabel(path)}</span>
                  </button>
                  <button
                    type='button'
                    className='glossa-library-folder-action'
                    aria-label={`${_('Rename Folder')}: ${path}`}
                    title={_('Rename Folder')}
                    onClick={() => {
                      folders.clearError();
                      setEditing({ path, parent: folderParent(path) });
                    }}
                  >
                    <Pencil size={14} />
                  </button>
                </>
              )}
              {editing?.path === undefined && editing?.parent === path && editor}
            </div>
          ))}
          {editing && editing.path === undefined && !editing.parent && editor}
          <button
            type='button'
            data-nav-focus
            className='glossa-library-new-folder'
            disabled={folders.busy || current.includes('/')}
            onClick={() => {
              folders.clearError();
              setEditing({ parent: current });
            }}
          >
            <Plus size={16} aria-hidden='true' />
            <span>{_('New Folder')}</span>
          </button>
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
            { value: LibraryGroupByType.Series, Icon: LibraryBig },
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
      <div className='glossa-library-navigation-footer'>
        <ApplicationSettingsButton variant='navigation' />
      </div>
    </nav>
  );
}
