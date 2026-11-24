import { useEffect, useId, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import type { GlossaIconProps } from '@/components/GlossaIcons';

type Panel = {
  id: string;
  label: string;
  Icon: ComponentType<GlossaIconProps>;
  content: ReactNode;
};
type Layout = { order: string[]; weights: Record<string, number> };
const STORAGE = 'glossa.reader.panel-dock.v1';
function load(): Layout {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE) ?? '{}');
    if (
      value &&
      typeof value === 'object' &&
      'order' in value &&
      'weights' in value &&
      Array.isArray(value.order) &&
      value.order.length <= 16 &&
      value.order.every((id) => typeof id === 'string') &&
      value.weights &&
      typeof value.weights === 'object'
    ) {
      const weights = Object.fromEntries(
        Object.entries(value.weights).filter(
          ([id, weight]) =>
            id.length < 60 &&
            typeof weight === 'number' &&
            Number.isFinite(weight) &&
            weight >= 0.2 &&
            weight <= 10,
        ),
      );
      return { order: [...new Set(value.order)], weights };
    }
  } catch {
    /* A local layout preference must never block reading. */
  }
  return { order: [], weights: {} };
}

export default function ReaderPanelDock({
  panels,
  activePanel,
  onActivate,
  onEmpty,
  onClose,
  header,
}: {
  panels: Panel[];
  activePanel: string;
  onActivate: (id: string) => void;
  onEmpty: () => void;
  onClose?: (id: string) => void;
  header?: (buttons: ReactNode) => ReactNode;
}) {
  const _ = useTranslation();
  const prefix = useId();
  const [layout, setLayout] = useState(load);
  const [open, setOpen] = useState<string[]>([activePanel]);
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [drop, setDrop] = useState<{ id: string; after: boolean }>();
  const stack = useRef<HTMLDivElement>(null);
  const toggles = useRef<HTMLDivElement>(null);
  const gesture = useRef<(() => void) | null>(null);
  const ids = panels.map((panel) => panel.id).join(':');
  useEffect(() => {
    const available = new Set(ids.split(':'));
    setOpen((current) =>
      [...new Set([...current.filter((id) => available.has(id)), activePanel])].filter((id) =>
        available.has(id),
      ),
    );
    setCollapsed((current) => current.filter((id) => id !== activePanel && available.has(id)));
  }, [activePanel, ids]);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE, JSON.stringify(layout));
    } catch {}
  }, [layout]);
  useEffect(() => () => gesture.current?.(), []);
  const ordered = [...panels].sort((a, b) => {
    const rank = (id: string) =>
      layout.order.includes(id)
        ? layout.order.indexOf(id)
        : 100 + panels.findIndex((panel) => panel.id === id);
    return rank(a.id) - rank(b.id);
  });
  const visible = ordered.filter((panel) => open.includes(panel.id));
  const expanded = visible.filter((panel) => !collapsed.includes(panel.id));
  const activate = (id: string) => {
    setOpen((current) => (current.includes(id) ? current : [...current, id]));
    setCollapsed((current) => current.filter((item) => item !== id));
    onActivate(id);
  };
  const reorder = (id: string, target: string, after: boolean) => {
    if (id === target) return;
    const order = ordered.map((panel) => panel.id).filter((item) => item !== id);
    order.splice(order.indexOf(target) + (after ? 1 : 0), 0, id);
    setLayout((current) => ({ ...current, order }));
  };
  const startMove = (event: React.PointerEvent<HTMLButtonElement>, id: string) => {
    if (event.button !== 0) return;
    const origin = { x: event.clientX, y: event.clientY };
    let target: { id: string; after: boolean } | undefined;
    const move = (next: PointerEvent) => {
      if (Math.hypot(next.clientX - origin.x, next.clientY - origin.y) < 6) return;
      const element = document
        .elementFromPoint(next.clientX, next.clientY)
        ?.closest<HTMLElement>('[data-dock-panel]');
      const targetId = element?.dataset['dockPanel'];
      if (element && targetId && targetId !== id && stack.current?.contains(element)) {
        target = {
          id: targetId,
          after:
            next.clientY >
            element.getBoundingClientRect().top + element.getBoundingClientRect().height / 2,
        };
        setDrop(target);
      } else {
        target = undefined;
        setDrop(undefined);
      }
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', key, true);
      gesture.current = null;
      setDrop(undefined);
    };
    const end = () => {
      if (target) reorder(id, target.id, target.after);
      cleanup();
    };
    const cancel = () => cleanup();
    const key = (next: KeyboardEvent) => {
      if (next.key === 'Escape') {
        next.preventDefault();
        next.stopPropagation();
        cancel();
      }
    };
    gesture.current?.();
    gesture.current = cleanup;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', key, true);
  };
  const resize = (id: string, nextId: string, delta: number, initial = layout) => {
    const first = initial.weights[id] ?? 1;
    const second = initial.weights[nextId] ?? 1;
    const change = Math.max(0.2 - first, Math.min(second - 0.2, delta));
    setLayout((current) => ({
      ...current,
      weights: { ...current.weights, [id]: first + change, [nextId]: second - change },
    }));
  };
  const startResize = (event: React.PointerEvent<HTMLDivElement>, id: string, nextId: string) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const top = event.clientY;
    const initial = layout;
    const total = expanded.reduce((sum, panel) => sum + (layout.weights[panel.id] ?? 1), 0);
    const height = stack.current?.clientHeight || 600;
    const move = (next: PointerEvent) =>
      resize(id, nextId, ((next.clientY - top) / height) * total, initial);
    const cleanup = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', cleanup);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', key, true);
      gesture.current = null;
    };
    const cancel = () => {
      setLayout(initial);
      cleanup();
    };
    const key = (next: KeyboardEvent) => {
      if (next.key === 'Escape') {
        next.preventDefault();
        next.stopPropagation();
        cancel();
      }
    };
    gesture.current?.();
    gesture.current = cancel;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', cleanup);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', key, true);
  };
  const buttons = (
    <div
      ref={toggles}
      className='flex items-center gap-1'
      role='group'
      aria-label={_('Reading panels')}
    >
      {panels.map(({ id, label, Icon }) => (
        <button
          key={id}
          type='button'
          title={label}
          aria-label={label}
          aria-pressed={open.includes(id)}
          aria-controls={`${prefix}-${id}`}
          className={`glossa-icon-button btn btn-ghost h-9 min-h-9 w-9 p-0 ${open.includes(id) ? 'bg-base-content/10' : ''}`}
          onKeyDown={(event) => {
            const rtl =
              getComputedStyle(event.currentTarget).direction === 'rtl' ||
              document.documentElement.dir === 'rtl';
            const index = panels.findIndex((panel) => panel.id === id);
            const step =
              event.key === 'ArrowRight'
                ? rtl
                  ? -1
                  : 1
                : event.key === 'ArrowLeft'
                  ? rtl
                    ? 1
                    : -1
                  : 0;
            const next =
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? panels.length - 1
                  : step
                    ? (index + step + panels.length) % panels.length
                    : -1;
            if (next >= 0) {
              event.preventDefault();
              (
                event.currentTarget.parentElement?.children[next] as HTMLButtonElement | undefined
              )?.focus();
              activate(panels[next]!.id);
            }
          }}
          onClick={() => activate(id)}
        >
          <Icon size={18} />
        </button>
      ))}
    </div>
  );
  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      {header ? header(buttons) : buttons}
      <div
        ref={stack}
        className='flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
      >
        {visible.map((panel) => {
          const closed = collapsed.includes(panel.id);
          const next = expanded[expanded.findIndex((item) => item.id === panel.id) + 1];
          return (
            <section
              key={panel.id}
              data-dock-panel={panel.id}
              aria-label={panel.label}
              className={`relative flex min-h-0 flex-col border-t border-base-content/10 ${drop?.id === panel.id ? (drop.after ? 'border-b-2 border-b-base-content' : 'border-t-2 border-t-base-content') : ''}`}
              style={{ flex: closed ? '0 0 auto' : `${layout.weights[panel.id] ?? 1} 0 160px` }}
            >
              <div className='flex h-8 shrink-0 items-center gap-1 px-2'>
                <button
                  type='button'
                  className='glossa-icon-button h-7 w-6'
                  aria-label={`${_(closed ? 'Expand panel' : 'Collapse panel')}: ${panel.label}`}
                  aria-expanded={!closed}
                  aria-controls={`${prefix}-${panel.id}`}
                  onClick={() =>
                    setCollapsed((current) =>
                      closed ? current.filter((id) => id !== panel.id) : [...current, panel.id],
                    )
                  }
                >
                  <span aria-hidden='true'>{closed ? '›' : '⌄'}</span>
                </button>
                <button
                  type='button'
                  className='min-w-0 flex-1 cursor-grab touch-none truncate text-start text-xs font-medium active:cursor-grabbing'
                  aria-label={`${_('Move panel')}: ${panel.label}`}
                  title={_('Drag to move · Alt+↑/↓')}
                  onPointerDown={(event) => startMove(event, panel.id)}
                  onKeyDown={(event) => {
                    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
                      event.preventDefault();
                      const offset = event.key === 'ArrowUp' ? -1 : 1;
                      const target = visible[visible.indexOf(panel) + offset];
                      if (target) reorder(panel.id, target.id, offset > 0);
                    }
                  }}
                >
                  {panel.label}
                </button>
                <button
                  type='button'
                  className='glossa-icon-button h-7 w-7'
                  aria-label={`${_('Close panel')}: ${panel.label}`}
                  onClick={() => {
                    const remaining = visible.filter((item) => item.id !== panel.id);
                    setOpen((current) => current.filter((id) => id !== panel.id));
                    onClose?.(panel.id);
                    if (!remaining.length) onEmpty();
                    else {
                      if (activePanel === panel.id) onActivate(remaining[0]!.id);
                      const index = panels.findIndex((item) => item.id === panel.id);
                      (toggles.current?.children[index] as HTMLButtonElement | undefined)?.focus();
                    }
                  }}
                >
                  <span aria-hidden='true'>×</span>
                </button>
              </div>
              <div
                onFocusCapture={() => onActivate(panel.id)}
                id={`${prefix}-${panel.id}`}
                hidden={closed}
                className={closed ? 'hidden' : 'flex min-h-0 flex-1 flex-col overflow-hidden'}
              >
                {panel.content}
              </div>
              {!closed && next && (
                <div
                  role='slider'
                  tabIndex={0}
                  aria-label={`${_('Resize panel')}: ${panel.label}`}
                  aria-orientation='vertical'
                  aria-valuemin={20}
                  aria-valuemax={1000}
                  aria-valuenow={Math.round((layout.weights[panel.id] ?? 1) * 100)}
                  className='absolute -bottom-1 start-0 z-10 h-2 w-full cursor-row-resize touch-none'
                  onPointerDown={(event) => startResize(event, panel.id, next.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                      event.preventDefault();
                      resize(panel.id, next.id, event.key === 'ArrowDown' ? 0.1 : -0.1);
                    }
                  }}
                />
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
