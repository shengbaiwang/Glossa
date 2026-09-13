import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import {
  ChevronDown,
  ChevronRight,
  Expand,
  ListTree,
  Plus,
  Redo2,
  Search,
  Trash2,
  Undo2,
  X,
} from '@/components/GlossaIcons';
import { useTranslation } from '@/hooks/useTranslation';
import {
  cleanMap,
  createMap,
  descendants,
  editTree,
  mapWorkspaceSchema,
  type LocalMap,
  type MapNode,
  type TreeEdit,
} from '@/glossa/mindmap/workspace';
import { useMapWorkspace } from '@/glossa/mindmap/workspaceSession';
import type { ReadingPanelProps } from './ReadingPassagePanel';

const SavedMindmaps = lazy(() => import('./SavedMindmaps'));
export default function MindmapPanel(props: ReadingPanelProps) {
  return <MapBook key={props.book.hash} {...props} />;
}
function MapBook(props: ReadingPanelProps) {
  const _ = useTranslation();
  const session = useMapWorkspace(props.book.hash);
  const [legacy, setLegacy] = useState(false);
  const [importError, setImportError] = useState(false);
  const backupInput = useRef<HTMLInputElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [search, setSearch] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const editBatch = useRef<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const pan = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const map = session.data?.maps.find((m) => m.id === session.data?.activeId);
  const root = map?.nodes.find((n) => n.parentId === null);
  const selected = map?.nodes.find((n) => n.id === map.selectedId) ?? root;
  const focus = map?.nodes.find((n) => n.id === map.focusId) ?? root;
  let selectedDepth = 1;
  let depthNode = selected;
  while (depthNode?.parentId) {
    selectedDepth++;
    depthNode = map?.nodes.find((n) => n.id === depthNode?.parentId);
  }
  useEffect(() => {
    const el = dialog.current;
    if (!el?.showModal) return;
    el.close();
    if (expanded) el.showModal();
    else el.show();
  }, [expanded, session.data !== null]);
  useEffect(() => {
    if (editingId) {
      input.current?.focus();
      input.current?.select();
    }
  }, [editingId]);
  useEffect(() => {
    if (!editingId)
      viewport.current
        ?.querySelector<HTMLButtonElement>('[data-selected="true"] .glossa-workmap-label')
        ?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [map?.selectedId, map?.focusId, map?.view, editingId]);
  const updateMap = (transform: (current: LocalMap) => LocalMap, history = false) => {
    session.update(
      (data) => ({
        ...data,
        maps: data.maps.map((m) => (m.id === data.activeId ? cleanMap(transform(m)) : m)),
      }),
      history,
    );
  };
  const edit = (action: TreeEdit) => {
    if (!map) return;
    const nodes = editTree(map.nodes, action);
    if (nodes === map.nodes) return;
    editBatch.current = null;
    updateMap(
      (m) => ({
        ...m,
        nodes,
        selectedId: action.type === 'delete' ? (selected?.parentId ?? root!.id) : action.id,
        collapsed: m.collapsed.filter(
          (id) => !nodes.some((n) => n.id === action.id && n.parentId === id),
        ),
      }),
      true,
    );
  };
  const add = (child: boolean) => {
    if (!map || !selected) return;
    const id = crypto.randomUUID();
    const action: TreeEdit = {
      type: 'add',
      id,
      parentId: child || !selected.parentId ? selected.id : selected.parentId,
      label: '',
      afterId: child ? undefined : selected.id,
    };
    if (editTree(map.nodes, action) === map.nodes) return;
    edit(action);
    setEditingId(id);
  };
  const beginEdit = (node: MapNode) => {
    editBatch.current = null;
    updateMap((m) => ({ ...m, selectedId: node.id }));
    setEditingId(node.id);
  };
  const textChange = (node: MapNode, label: string, relation: string) => {
    const history = editBatch.current !== node.id;
    editBatch.current = node.id;
    updateMap(
      (m) => ({ ...m, nodes: editTree(m.nodes, { type: 'text', id: node.id, label, relation }) }),
      history,
    );
  };
  const toggle = (id: string) =>
    updateMap((m) => ({
      ...m,
      collapsed: m.collapsed.includes(id)
        ? m.collapsed.filter((n) => n !== id)
        : [...m.collapsed, id],
    }));
  const reveal = (id: string) => {
    const ancestors = new Set<string>();
    let current = map?.nodes.find((n) => n.id === id);
    while (current?.parentId) {
      ancestors.add(current.parentId);
      current = map?.nodes.find((n) => n.id === current?.parentId);
    }
    updateMap((m) => ({
      ...m,
      selectedId: id,
      focusId: null,
      collapsed: m.collapsed.filter((n) => !ancestors.has(n)),
    }));
    setSearch(null);
  };
  const visible: MapNode[] = [];
  const collect = (node: MapNode) => {
    visible.push(node);
    if (!map?.collapsed.includes(node.id))
      map?.nodes.filter((n) => n.parentId === node.id).forEach(collect);
  };
  if (focus) collect(focus);
  const keydown = (event: KeyboardEvent) => {
    event.stopPropagation();
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    const command = event.metaKey || event.ctrlKey;
    const target = event.target as HTMLElement;
    const textInput = target instanceof HTMLTextAreaElement;
    if (command && event.key.toLowerCase() === 'z') {
      if (target instanceof HTMLInputElement && target.closest('.glossa-workmap-search')) return;
      event.preventDefault();
      editBatch.current = null;
      session.undo(event.shiftKey);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setEditingId(null);
      setSearch(null);
      if (expanded && !editingId && search === null) setExpanded(false);
      return;
    }
    if (command && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      setSearch('');
      return;
    }
    if (!selected || target instanceof HTMLSelectElement || target instanceof HTMLInputElement)
      return;
    if (textInput || target.classList.contains('glossa-workmap-label')) {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        add(command);
      } else if (event.key === 'Tab' && (textInput || command)) {
        event.preventDefault();
        edit({ type: event.shiftKey ? 'outdent' : 'indent', id: selected.id });
      } else if (event.altKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault();
        edit({ type: event.key === 'ArrowUp' ? 'up' : 'down', id: selected.id });
      } else if (!textInput) {
        let next: MapNode | undefined;
        const index = visible.findIndex((n) => n.id === selected.id);
        if (event.key === 'ArrowDown') next = visible[index + 1];
        if (event.key === 'ArrowUp') next = visible[index - 1];
        if (event.key === 'Home') next = visible[0];
        if (event.key === 'End') next = visible.at(-1);
        if (event.key === 'ArrowLeft') {
          if (
            !map?.collapsed.includes(selected.id) &&
            map?.nodes.some((n) => n.parentId === selected.id)
          )
            toggle(selected.id);
          else next = visible.find((n) => n.id === selected.parentId);
        }
        if (event.key === 'ArrowRight') {
          if (map?.collapsed.includes(selected.id)) toggle(selected.id);
          else next = visible.find((n) => n.parentId === selected.id);
        }
        if (next) {
          updateMap((m) => ({ ...m, selectedId: next!.id }));
          viewport.current
            ?.querySelector<HTMLButtonElement>(`[data-node-id="${next.id}"] .glossa-workmap-label`)
            ?.focus();
        }
        if (event.key.startsWith('Arrow') || ['Home', 'End'].includes(event.key))
          event.preventDefault();
        if (event.key === 'F2') {
          event.preventDefault();
          beginEdit(selected);
        }
        if (event.key === 'Delete' || event.key === 'Backspace') {
          event.preventDefault();
          edit({ type: 'delete', id: selected.id });
        }
      }
    }
  };
  const download = () => {
    if (!session.data) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(session.data, null, 2)], { type: 'application/json' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'glossa-mindmaps.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const importBackup = async (file: File) => {
    setImportError(false);
    try {
      if (file.size > 5_000_000) throw new Error('Backup too large');
      const imported = mapWorkspaceSchema.parse(JSON.parse(await file.text()));
      if (!imported.maps.length) throw new Error('Empty backup');
      session.update((data) => {
        if (data.maps.length + imported.maps.length > 20) {
          setImportError(true);
          return data;
        }
        const copies = imported.maps.map((m) => cleanMap({ ...m, id: crypto.randomUUID() }));
        return { ...data, maps: [...data.maps, ...copies], activeId: copies[0]!.id };
      });
      setLegacy(false);
      setEditingId(null);
    } catch {
      setImportError(true);
    }
  };
  const newMap = () => {
    const created = createMap(_('Untitled mind map'));
    session.update((data) => ({ ...data, maps: [...data.maps, created], activeId: created.id }));
    setEditingId(created.selectedId);
    editBatch.current = null;
    setLegacy(false);
  };
  const iconButton = (label: string, icon: ReactNode, action: () => void, disabled = false) => (
    <button
      type='button'
      className='glossa-workmap-icon'
      aria-label={label}
      title={label}
      onClick={action}
      disabled={disabled}
    >
      {icon}
    </button>
  );
  const renderNode = (node: MapNode): ReactNode => {
    const children = map!.nodes.filter((n) => n.parentId === node.id);
    const collapsed = map!.collapsed.includes(node.id);
    return (
      <li key={node.id} data-node-id={node.id}>
        <div
          className='glossa-workmap-node'
          data-selected={map!.selectedId === node.id}
          data-root={!node.parentId}
        >
          {children.length > 0 ? (
            <button
              className='glossa-workmap-fold'
              type='button'
              aria-label={_(collapsed ? 'Expand {{node}}' : 'Collapse {{node}}', {
                node: node.label || _('Untitled idea'),
              })}
              aria-expanded={!collapsed}
              onClick={() => toggle(node.id)}
            >
              {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
            </button>
          ) : (
            <span className='glossa-workmap-dot' aria-hidden='true' />
          )}
          {editingId === node.id ? (
            <div
              className='glossa-workmap-edit'
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  setEditingId(null);
                  editBatch.current = null;
                }
              }}
            >
              <textarea
                ref={input}
                aria-label={_('Idea text')}
                value={node.label}
                maxLength={500}
                rows={3}
                dir='auto'
                onChange={(event) => textChange(node, event.target.value, node.relation)}
              />
              {node.parentId && (
                <input
                  aria-label={_('Relationship')}
                  placeholder={_('Relationship')}
                  value={node.relation}
                  maxLength={80}
                  dir='auto'
                  onChange={(event) => textChange(node, node.label, event.target.value)}
                />
              )}
            </div>
          ) : (
            <button
              type='button'
              className='glossa-workmap-label'
              aria-pressed={map!.selectedId === node.id}
              onClick={() => {
                if (map!.view === 'outline') beginEdit(node);
                else updateMap((m) => ({ ...m, selectedId: node.id }));
              }}
              onDoubleClick={() => beginEdit(node)}
              dir='auto'
            >
              {node.relation && <small>{node.relation}</small>}
              <span>{node.label || _('Untitled idea')}</span>
              {collapsed && children.length > 0 && (
                <small className='glossa-workmap-count'>
                  +{descendants(map!.nodes, node.id).size - 1}
                </small>
              )}
            </button>
          )}
        </div>
        {children.length > 0 && !collapsed && <ul>{children.map(renderNode)}</ul>}
      </li>
    );
  };
  if (!session.data)
    return (
      <div className='glossa-workmap-empty' role='status'>
        <p>
          {_(
            session.status === 'loading'
              ? 'Loading mind maps…'
              : 'Saved mind maps could not be loaded.',
          )}
        </p>
        {session.status === 'error' && (
          <button className='glossa-button' type='button' onClick={() => void session.retry()}>
            {_('Retry')}
          </button>
        )}
      </div>
    );
  const path: MapNode[] = [];
  let ancestor = focus;
  while (ancestor) {
    path.unshift(ancestor);
    ancestor = map?.nodes.find((n) => n.id === ancestor?.parentId);
  }
  const query = search?.trim().toLocaleLowerCase();
  const matches = query
    ? (map?.nodes.filter((n) => `${n.label} ${n.relation}`.toLocaleLowerCase().includes(query)) ??
      [])
    : [];
  const status =
    session.status === 'ready'
      ? _('Saved on this device')
      : session.status === 'saving'
        ? _('Saving…')
        : _('Not saved');
  return (
    <dialog
      ref={dialog}
      open
      aria-label={_('Mind map workspace')}
      className={`glossa-workmap ${expanded ? 'is-expanded' : ''}`}
      onCancel={(event) => {
        event.preventDefault();
        setExpanded(false);
      }}
      onKeyDown={keydown}
    >
      <input
        ref={backupInput}
        type='file'
        accept='.json,application/json'
        hidden
        aria-label={_('Import mind maps')}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void importBackup(file);
          event.target.value = '';
        }}
      />
      <header className='glossa-workmap-header'>
        <select
          aria-label={_('Mind maps')}
          value={legacy ? 'legacy' : (map?.id ?? '')}
          onChange={(event) => {
            const value = event.target.value;
            setLegacy(value === 'legacy');
            setEditingId(null);
            setSearch(null);
            if (value !== 'legacy') session.update((data) => ({ ...data, activeId: value }), false);
          }}
        >
          {!map && <option value=''>{_('Mind maps')}</option>}
          {session.data.maps.map((m) => (
            <option key={m.id} value={m.id}>
              {m.nodes.find((n) => !n.parentId)?.label || _('Untitled mind map')}
            </option>
          ))}
          <option value='legacy'>{_('Earlier generated maps')}</option>
        </select>
        {iconButton(_('New mind map'), <Plus size={18} />, newMap, session.data.maps.length >= 20)}
        {iconButton(
          _(expanded ? 'Close expanded view' : 'Expand workspace'),
          expanded ? <X size={18} /> : <Expand size={18} />,
          () => setExpanded(!expanded),
        )}
      </header>
      {legacy ? (
        <Suspense fallback={<p role='status'>{_('Loading…')}</p>}>
          <SavedMindmaps {...props} onNavigate={() => setExpanded(false)} />
        </Suspense>
      ) : map && root && focus ? (
        <>
          <div className='glossa-workmap-toolbar'>
            <div className='glossa-workmap-views' role='group' aria-label={_('Map view')}>
              {(['outline', 'map'] as const).map((view) => (
                <button
                  key={view}
                  type='button'
                  aria-pressed={map.view === view}
                  onClick={() => {
                    setEditingId(null);
                    updateMap((m) => ({ ...m, view }));
                  }}
                >
                  {_(view === 'outline' ? 'Outline view' : 'Mind map')}
                </button>
              ))}
            </div>
            <div className='glossa-workmap-actions'>
              {iconButton(
                _('Undo'),
                <Undo2 size={16} />,
                () => {
                  editBatch.current = null;
                  session.undo();
                },
                !session.canUndo,
              )}
              {iconButton(
                _('Redo'),
                <Redo2 size={16} />,
                () => {
                  editBatch.current = null;
                  session.undo(true);
                },
                !session.canRedo,
              )}
              {iconButton(_('Find an idea'), <Search size={16} />, () =>
                setSearch(search === null ? '' : null),
              )}
            </div>
          </div>
          {search !== null && (
            <div className='glossa-workmap-search'>
              <input
                autoFocus
                aria-label={_('Find an idea')}
                placeholder={_('Find an idea')}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              {query && (
                <div className='glossa-workmap-results' aria-label={_('Search results')}>
                  {matches.length === 0 ? (
                    <p role='status'>{_('No matching ideas')}</p>
                  ) : (
                    matches.map((node) => (
                      <button type='button' key={node.id} onClick={() => reveal(node.id)}>
                        {node.label || _('Untitled idea')}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          )}
          {map.focusId && (
            <nav className='glossa-workmap-path' aria-label={_('Focused branch')}>
              {path.map((node, index) => (
                <button
                  key={node.id}
                  type='button'
                  onClick={() =>
                    updateMap((m) => ({
                      ...m,
                      focusId: node.parentId ? node.id : null,
                      selectedId: node.id,
                    }))
                  }
                >
                  {index > 0 && <span aria-hidden='true'> / </span>}
                  {node.label || _('Untitled idea')}
                </button>
              ))}
            </nav>
          )}
          <div
            ref={viewport}
            className='glossa-workmap-viewport'
            data-view={map.view}
            onPointerDown={(event) => {
              if (
                map.view !== 'map' ||
                event.button !== 0 ||
                (event.target as HTMLElement).closest('button, input, textarea')
              )
                return;
              const el = event.currentTarget;
              pan.current = {
                x: event.clientX,
                y: event.clientY,
                left: el.scrollLeft,
                top: el.scrollTop,
              };
              el.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              if (pan.current) {
                event.currentTarget.scrollLeft = pan.current.left - (event.clientX - pan.current.x);
                event.currentTarget.scrollTop = pan.current.top - (event.clientY - pan.current.y);
              }
            }}
            onPointerUp={() => {
              pan.current = null;
            }}
            onLostPointerCapture={() => {
              pan.current = null;
            }}
            onPointerCancel={() => {
              pan.current = null;
            }}
          >
            <div
              ref={canvas}
              className='glossa-workmap-canvas'
              style={{ zoom: map.view === 'map' ? map.zoom : 1 }}
            >
              <ul aria-label={_('Idea hierarchy')}>{renderNode(focus)}</ul>
            </div>
          </div>
          <div className='glossa-workmap-context' role='group' aria-label={_('Edit selected idea')}>
            <button
              type='button'
              onClick={() => add(true)}
              disabled={map.nodes.length >= 200 || selectedDepth >= 12}
            >
              <Plus size={14} />
              {_('Child idea')}
            </button>
            <button type='button' onClick={() => add(false)} disabled={map.nodes.length >= 200}>
              {_('Sibling idea')}
            </button>
            <details
              className='glossa-workmap-more'
              onClick={(event) => {
                if ((event.target as HTMLElement).closest('button'))
                  event.currentTarget.open = false;
              }}
            >
              <summary>{_('More')}</summary>
              <div>
                <button type='button' onClick={() => selected && beginEdit(selected)}>
                  {_('Edit idea')}
                </button>
                {(['indent', 'outdent', 'up', 'down'] as const).map((type, index) => (
                  <button
                    type='button'
                    key={type}
                    disabled={
                      !selected ||
                      JSON.stringify(editTree(map.nodes, { type, id: selected.id })) ===
                        JSON.stringify(map.nodes)
                    }
                    onClick={() => selected && edit({ type, id: selected.id })}
                  >
                    {_(['Indent', 'Outdent', 'Move up', 'Move down'][index]!)}
                  </button>
                ))}
                <button
                  type='button'
                  disabled={selected?.id === root.id}
                  onClick={() => {
                    setEditingId(null);
                    updateMap((m) => ({
                      ...m,
                      focusId: m.selectedId,
                      collapsed: m.collapsed.filter((n) => n !== m.selectedId),
                    }));
                  }}
                >
                  {_('Focus branch')}
                </button>
                <button
                  type='button'
                  disabled={!selected?.parentId}
                  onClick={() => selected && edit({ type: 'delete', id: selected.id })}
                >
                  <Trash2 size={14} />
                  {_('Delete branch')}
                </button>
                <button type='button' onClick={download}>
                  {_('Download mind maps')}
                </button>
                <button type='button' onClick={() => backupInput.current?.click()}>
                  {_('Import mind maps')}
                </button>
                <button
                  type='button'
                  onClick={() =>
                    session.update((data) => {
                      const maps = data.maps.filter((m) => m.id !== map.id);
                      return { ...data, maps, activeId: maps[0]?.id ?? null };
                    })
                  }
                >
                  {_('Delete mind map')}
                </button>
              </div>
            </details>
          </div>
          <footer className='glossa-workmap-footer'>
            <select
              aria-label={_('Visible levels')}
              value=''
              onChange={(event) => {
                const level = Number(event.target.value);
                const depth = (node: MapNode): number =>
                  node.parentId ? 1 + depth(map.nodes.find((n) => n.id === node.parentId)!) : 1;
                updateMap((m) => ({
                  ...m,
                  collapsed:
                    level === 0
                      ? []
                      : m.nodes
                          .filter(
                            (n) => depth(n) >= level && m.nodes.some((c) => c.parentId === n.id),
                          )
                          .map((n) => n.id),
                }));
              }}
            >
              <option value='' disabled>
                {_('Levels')}
              </option>
              <option value='1'>{_('Root only')}</option>
              <option value='2'>{_('Two levels')}</option>
              <option value='3'>{_('Three levels')}</option>
              <option value='0'>{_('Expand all')}</option>
            </select>
            {map.view === 'map' && (
              <div className='glossa-workmap-zoom'>
                {iconButton(
                  _('Zoom out'),
                  '−',
                  () => updateMap((m) => ({ ...m, zoom: Math.max(0.4, m.zoom - 0.1) })),
                  map.zoom <= 0.4,
                )}
                <button
                  type='button'
                  title={_('Reset zoom')}
                  onClick={() => updateMap((m) => ({ ...m, zoom: 1 }))}
                >
                  {Math.round(map.zoom * 100)}%
                </button>
                {iconButton(
                  _('Zoom in'),
                  '+',
                  () => updateMap((m) => ({ ...m, zoom: Math.min(1.6, m.zoom + 0.1) })),
                  map.zoom >= 1.6,
                )}
                <button
                  type='button'
                  onClick={() => {
                    if (!canvas.current || !viewport.current) return;
                    const rect = canvas.current.getBoundingClientRect();
                    const zoom = Math.max(
                      0.4,
                      Math.min(
                        1.6,
                        (viewport.current.clientWidth - 24) / (rect.width / map.zoom),
                        (viewport.current.clientHeight - 24) / (rect.height / map.zoom),
                      ),
                    );
                    updateMap((m) => ({ ...m, zoom }));
                    viewport.current.scrollTo(0, 0);
                  }}
                >
                  {_('Fit canvas')}
                </button>
              </div>
            )}
            <span className='glossa-workmap-status' role='status' title={status}>
              {status}
            </span>
          </footer>
        </>
      ) : (
        <div className='glossa-workmap-empty'>
          <ListTree size={28} />
          <h3>{_('Give your ideas a shape')}</h3>
          <p>{_('Start with a question. Let the connections grow.')}</p>
          <button type='button' className='glossa-button glossa-button-primary' onClick={newMap}>
            <Plus size={16} />
            {_('New mind map')}
          </button>
          <button
            type='button'
            className='glossa-button'
            onClick={() => backupInput.current?.click()}
          >
            {_('Import mind maps')}
          </button>
          {session.canRedo && (
            <button type='button' className='glossa-button' onClick={() => session.undo(true)}>
              {_('Redo')}
            </button>
          )}
          {session.canUndo && (
            <button type='button' className='glossa-button' onClick={() => session.undo()}>
              {_('Undo')}
            </button>
          )}
        </div>
      )}
      {importError && (
        <p className='glossa-workmap-error' role='alert'>
          {_('The mind map backup could not be imported.')}
        </p>
      )}
      {(session.status === 'error' || session.status === 'conflict') && (
        <div className='glossa-workmap-error' role='alert'>
          <p>
            {_(
              session.status === 'conflict'
                ? 'This book’s maps changed in another window. Download your edits before reopening the app.'
                : 'Your changes are still here. Saving failed.',
            )}
          </p>
          {session.status === 'error' && (
            <button type='button' onClick={() => void session.retry()}>
              {_('Retry saving')}
            </button>
          )}
          <button type='button' onClick={download}>
            {_('Download mind maps')}
          </button>
        </div>
      )}
    </dialog>
  );
}
