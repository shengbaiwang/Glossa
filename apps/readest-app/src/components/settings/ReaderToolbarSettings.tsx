import { useState } from 'react';
import { create } from 'zustand';
import { ArrowDown, ArrowUp } from '@/components/GlossaIcons';
import { useTranslation } from '@/hooks/useTranslation';
import { Toggle } from '@/components/primitives/toggle';
import { BoxedList, SettingsRow } from './primitives';

type LayoutEdit = (layout: Layout) => Layout;
const dragType = 'application/x-glossa-reader-tool';
const storageKey = 'glossa.readerToolbar';
const defaultOrder = ['annotation', 'readingTime', 'bookmark', 'appearance'] as const;
export type ReaderTool = (typeof defaultOrder)[number];
type Layout = { order: ReaderTool[]; hidden: ReaderTool[] };
const defaults: Layout = { order: [...defaultOrder], hidden: [] };

const validTools = (value: unknown): ReaderTool[] =>
  Array.isArray(value)
    ? [...new Set(defaultOrder.filter((tool) => value.includes(tool)))].sort(
        (a, b) => value.indexOf(a) - value.indexOf(b),
      )
    : [];

function loadLayout(): Layout {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
    if (!saved) return defaults;
    const order = validTools(saved.order);
    return {
      order: [...order, ...defaultOrder.filter((tool) => !order.includes(tool))],
      hidden: validTools(saved.hidden),
    };
  } catch {
    return defaults;
  }
}

export const useReaderToolbarLayout = create<{ layout: Layout }>(() => ({ layout: loadLayout() }));

const toolLabels: Record<ReaderTool, string> = {
  annotation: 'Annotation Actions',
  readingTime: 'Reading time',
  bookmark: 'Bookmark',
  appearance: 'Reading Appearance',
};

export default function ReaderToolbarSettings({ inline = false }: { inline?: boolean }) {
  const _ = useTranslation();
  const { layout } = useReaderToolbarLayout();
  const [failed, setFailed] = useState<LayoutEdit | null>(null);

  const save = (edit: LayoutEdit) => {
    const next = edit(useReaderToolbarLayout.getState().layout);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      useReaderToolbarLayout.setState({ layout: next });
      setFailed(null);
    } catch {
      setFailed(() => edit);
    }
  };

  const move = (tool: ReaderTool, destination: (order: ReaderTool[], from: number) => number) => {
    save((current) => {
      const order = [...current.order];
      const from = order.indexOf(tool);
      const to = destination(order, from);
      if (to < 0 || to >= order.length || to === from) return current;
      order.splice(from, 1);
      order.splice(to, 0, tool);
      return { ...current, order };
    });
  };

  return (
    <BoxedList
      title={inline ? undefined : _('Customize Toolbar')}
      data-setting-id='settings.theme.readerToolbar'
    >
      {layout.order.map((tool, index) => {
        const label = _(toolLabels[tool]);
        const visible = !layout.hidden.includes(tool);
        return (
          <SettingsRow
            key={tool}
            className='ps-3'
            label={
              <span
                draggable
                className='cursor-grab'
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData(dragType, tool);
                }}
                onDragOver={(event) => {
                  if (event.dataTransfer.types.includes(dragType)) event.preventDefault();
                }}
                onDrop={(event) => {
                  const source = defaultOrder.find(
                    (id) => id === event.dataTransfer.getData(dragType),
                  );
                  if (!source) return;
                  event.preventDefault();
                  move(source, (order) => order.indexOf(tool));
                }}
              >
                {label}
              </span>
            }
          >
            <div className='flex shrink-0 items-center gap-1'>
              {([-1, 1] as const).map((offset) => {
                const Icon = offset < 0 ? ArrowUp : ArrowDown;
                const direction = _(offset < 0 ? 'Move up' : 'Move down');
                return (
                  <button
                    key={offset}
                    type='button'
                    className='glossa-icon-button glossa-pane-control'
                    aria-label={`${direction} · ${label}`}
                    disabled={!layout.order[index + offset]}
                    onClick={() => move(tool, (_order, from) => from + offset)}
                  >
                    <Icon size={16} aria-hidden='true' />
                  </button>
                );
              })}
              <Toggle
                aria-label={label}
                checked={visible}
                onChange={() =>
                  save((current) => ({
                    ...current,
                    hidden: visible
                      ? [...new Set([...current.hidden, tool])]
                      : current.hidden.filter((id) => id !== tool),
                  }))
                }
              />
            </div>
          </SettingsRow>
        );
      })}
      <div className='flex flex-wrap items-center justify-end gap-2 p-2'>
        {failed && (
          <>
            <span role='alert' className='text-error me-auto text-sm'>
              {_('Failed to save settings')}
            </span>
            <button type='button' className='glossa-button' onClick={() => save(failed)}>
              {_('Retry saving')}
            </button>
          </>
        )}
        <button type='button' className='glossa-button' onClick={() => save(() => defaults)}>
          {_('Restore Defaults')}
        </button>
      </div>
    </BoxedList>
  );
}
