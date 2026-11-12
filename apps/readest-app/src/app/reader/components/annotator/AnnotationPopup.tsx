import clsx from 'clsx';
import React, { useEffect, useRef, useState } from 'react';
import { Ellipsis } from '@/components/GlossaIcons';
import { useTranslation } from '@/hooks/useTranslation';
import { Position } from '@/utils/sel';
import { BookNote, HighlightColor, HighlightStyle } from '@/types/book';
import Popup from '@/components/Popup';
import AnnotationToolButton from './AnnotationToolButton';
import AnnotationNotes from './AnnotationNotes';
import HighlightOptions from './HighlightOptions';

interface AnnotationPopupProps {
  bookKey: string;
  dir: 'ltr' | 'rtl';
  isVertical: boolean;
  buttons: Array<{
    tooltipText: string;
    Icon: React.ElementType;
    onClick: React.MouseEventHandler<HTMLButtonElement>;
    disabled?: boolean;
    visible?: boolean;
  }>;
  notes: BookNote[];
  position: Position;
  trianglePosition: Position;
  highlightOptionsVisible: boolean;
  selectedStyle: HighlightStyle;
  selectedColor: HighlightColor;
  popupWidth: number;
  popupHeight: number;
  globalToggleAvailable?: boolean;
  globalToggleActive?: boolean;
  onToggleGlobal?: () => void;
  onHighlight: (update?: boolean) => void;
  onDismiss: () => void;
}

const AnnotationPopup: React.FC<AnnotationPopupProps> = ({
  bookKey,
  dir,
  isVertical,
  buttons,
  notes,
  position,
  trianglePosition,
  highlightOptionsVisible,
  selectedStyle,
  selectedColor,
  popupWidth,
  popupHeight,
  globalToggleAvailable,
  globalToggleActive,
  onToggleGlobal,
  onHighlight,
  onDismiss,
}) => {
  const _ = useTranslation();
  const [more, setMore] = useState(false);
  const moreButton = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const primaryCount = buttons.length > 4 ? 4 : buttons.length;
  const primary =
    notes.length || highlightOptionsVisible ? buttons : buttons.slice(0, primaryCount);
  const overflow = notes.length || highlightOptionsVisible ? [] : buttons.slice(primaryCount);
  useEffect(() => {
    if (more) menu.current?.querySelector('button')?.focus({ preventScroll: true });
  }, [more]);
  const dismiss = () => {
    if (more) {
      setMore(false);
      moreButton.current?.focus({ preventScroll: true });
    } else onDismiss();
  };
  return (
    <div dir={dir}>
      <Popup
        width={isVertical ? popupHeight : popupWidth}
        height={isVertical ? popupWidth : popupHeight}
        minHeight={isVertical ? popupWidth : popupHeight}
        position={position}
        trianglePosition={trianglePosition}
        className={clsx(
          'selection-popup',
          notes.length > 0 ? 'bg-transparent' : !highlightOptionsVisible && 'not-eink:shadow-md',
        )}
        onDismiss={dismiss}
      >
        <div className={clsx('flex h-full gap-4', isVertical ? 'flex-row' : 'flex-col')}>
          <div
            className={clsx(
              'selection-buttons flex h-full w-full items-center',
              highlightOptionsVisible ? 'justify-between p-2' : 'justify-evenly px-1',
              isVertical ? 'flex-col overflow-y-auto' : 'flex-row overflow-x-auto',
              notes.length > 0 && 'hidden',
            )}
            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
          >
            {primary.map((button) => {
              if (button.visible === false) return null;
              return (
                <AnnotationToolButton
                  key={button.tooltipText}
                  showTooltip={!highlightOptionsVisible}
                  tooltipText={button.tooltipText}
                  Icon={button.Icon}
                  onClick={button.onClick}
                  disabled={button.disabled}
                />
              );
            })}
            {overflow.length > 0 && (
              <button
                ref={moreButton}
                type='button'
                aria-label={_('More')}
                aria-expanded={more}
                className='hover:bg-base-200 flex size-9 shrink-0 items-center justify-center rounded-md'
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => setMore(!more)}
              >
                <Ellipsis size={18} />
              </button>
            )}
          </div>
          {more && overflow.length > 0 && (
            <div
              ref={menu}
              className={clsx(
                'eink-bordered bg-base-100 border-base-content/20 absolute z-10 w-max max-w-48 space-y-0.5 rounded-lg border p-1 not-eink:shadow-md',
                trianglePosition.dir === 'up' && 'bottom-full end-0 mb-1',
                trianglePosition.dir === 'down' && 'top-full end-0 mt-1',
                trianglePosition.dir === 'left' && 'end-full top-0 me-1',
                trianglePosition.dir === 'right' && 'start-full top-0 ms-1',
              )}
            >
              {overflow.map(({ tooltipText, Icon, onClick, disabled }) => (
                <button
                  key={tooltipText}
                  type='button'
                  className='hover:bg-base-200 flex min-h-10 w-full items-center gap-2 rounded-md px-2 text-start text-sm'
                  disabled={disabled}
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={(event) => {
                    setMore(false);
                    onClick(event);
                  }}
                >
                  <Icon size={16} />
                  {tooltipText}
                </button>
              ))}
            </div>
          )}
          {notes.length > 0 ? (
            <AnnotationNotes
              bookKey={bookKey}
              isVertical={isVertical}
              notes={notes}
              toolsVisible={false}
              triangleDir={trianglePosition.dir!}
              popupWidth={isVertical ? popupHeight : popupWidth}
              popupHeight={isVertical ? popupWidth : popupHeight}
              onDismiss={onDismiss}
            />
          ) : (
            highlightOptionsVisible && (
              <HighlightOptions
                isVertical={isVertical}
                triangleDir={trianglePosition.dir!}
                popupWidth={isVertical ? popupHeight : popupWidth}
                popupHeight={isVertical ? popupWidth : popupHeight}
                selectedStyle={selectedStyle}
                selectedColor={selectedColor}
                globalToggleAvailable={globalToggleAvailable}
                globalToggleActive={globalToggleActive}
                onToggleGlobal={onToggleGlobal}
                onHandleHighlight={onHighlight}
              />
            )
          )}
        </div>
      </Popup>
    </div>
  );
};

export default AnnotationPopup;
