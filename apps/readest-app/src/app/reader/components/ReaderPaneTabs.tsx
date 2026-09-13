import { useId, useRef, type ComponentType, type KeyboardEvent } from 'react';
import type { GlossaIconProps } from '@/components/GlossaIcons';

interface PaneTab<T extends string> {
  id: T;
  label: string;
  Icon: ComponentType<GlossaIconProps>;
  panelId?: string;
}

/** One selection contract and one visual control for both reading panes. */
export default function ReaderPaneTabs<T extends string>({
  tabs,
  activeTab,
  onTabChange,
  label,
  idPrefix,
}: {
  tabs: PaneTab<T>[];
  activeTab: T;
  onTabChange: (tab: T) => void;
  label: string;
  idPrefix?: string;
}) {
  const localId = useId();
  const prefix = idPrefix ?? localId;
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const rtl = event.currentTarget.closest('[dir]')?.getAttribute('dir') === 'rtl';
    let next: number;
    switch (event.key) {
      case 'ArrowRight':
        next = (index + (rtl ? -1 : 1) + tabs.length) % tabs.length;
        break;
      case 'ArrowLeft':
        next = (index + (rtl ? 1 : -1) + tabs.length) % tabs.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = tabs.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    refs.current[next]?.focus();
    onTabChange(tabs[next]!.id);
  };

  return (
    <div
      className='glossa-pane-tabs'
      role='tablist'
      aria-label={label}
      aria-orientation='horizontal'
    >
      {tabs.map(({ id, label, Icon, panelId }, index) => (
        <button
          key={id}
          ref={(element) => {
            refs.current[index] = element;
          }}
          id={`${prefix}-tab-${id}`}
          type='button'
          role='tab'
          className='glossa-pane-control'
          title={label}
          aria-label={label}
          aria-selected={activeTab === id}
          aria-controls={panelId}
          tabIndex={activeTab === id ? 0 : -1}
          onClick={() => onTabChange(id)}
          onKeyDown={(event) => handleKeyDown(event, index)}
        >
          <Icon size={18} />
        </button>
      ))}
    </div>
  );
}
