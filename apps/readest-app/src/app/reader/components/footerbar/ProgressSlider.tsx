import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';

interface ProgressSliderProps {
  value: number;
  disabled?: boolean;
  active?: boolean;
  onCommit: (value: number) => void;
}

const rangeKeys = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown',
]);

/** Preview locally while scrubbing. Moving the book is a single, explicit commit. */
const ProgressSlider: React.FC<ProgressSliderProps> = ({
  value,
  disabled = false,
  active = true,
  onCommit,
}) => {
  const _ = useTranslation();
  const [preview, setPreview] = useState(value);
  const [scrubbing, setScrubbing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const interaction = useRef<{
    value: number;
    pointerId?: number;
    cancelled?: boolean;
  } | null>(null);

  const releasePointer = () => {
    const pointerId = interaction.current?.pointerId;
    interaction.current = null;
    if (pointerId !== undefined && inputRef.current?.hasPointerCapture(pointerId)) {
      inputRef.current.releasePointerCapture(pointerId);
    }
    setScrubbing(false);
  };

  const cancel = () => {
    releasePointer();
    setPreview(value);
  };

  const commit = () => {
    const draft = interaction.current;
    if (!draft) return;
    releasePointer();
    if (!draft.cancelled && draft.value !== value) onCommit(draft.value);
  };

  useEffect(() => {
    if (!active || disabled) {
      releasePointer();
      inputRef.current?.blur();
    }
    if (!interaction.current) setPreview(value);
  }, [value, active, disabled]);

  return (
    <div className='glossa-progress-control' data-scrubbing={scrubbing}>
      <div className='glossa-progress-slider'>
        <div className='glossa-progress-track' aria-hidden='true'>
          <span style={{ width: `${preview}%` }} />
        </div>
        <input
          ref={inputRef}
          type='range'
          min={0}
          max={100}
          step={0.1}
          disabled={disabled}
          className='glossa-reader-range'
          aria-label={_('Reading Progress')}
          aria-valuetext={`${Math.round(preview)}%`}
          value={preview}
          onChange={(event) => {
            if (interaction.current?.cancelled) {
              // Escape ends the preview, but a held pointer/key can still emit input.
              event.currentTarget.value = String(value);
              setPreview(value);
              return;
            }
            const next = Number(event.currentTarget.value);
            setPreview(next);
            if (interaction.current) interaction.current.value = next;
            // Assistive technology may change the value without a pointer/key sequence.
            else onCommit(next);
          }}
          onPointerDown={(event) => {
            if (event.button > 0 || disabled) return;
            interaction.current = { value: preview, pointerId: event.pointerId };
            event.currentTarget.setPointerCapture(event.pointerId);
            setScrubbing(true);
          }}
          onPointerUp={commit}
          onPointerCancel={cancel}
          onLostPointerCapture={() => {
            if (interaction.current) cancel();
          }}
          onBlur={() => {
            if (interaction.current) cancel();
          }}
          // Capture precedes the toolbar's native spatial-navigation listener.
          onKeyDownCapture={(event) => {
            event.stopPropagation();
            if (event.key === 'Escape') {
              event.preventDefault();
              if (interaction.current) interaction.current.cancelled = true;
              setPreview(value);
            } else if (rangeKeys.has(event.key) && !interaction.current) {
              interaction.current = { value: preview };
              setScrubbing(true);
            }
          }}
          onKeyUpCapture={(event) => {
            event.stopPropagation();
            if (rangeKeys.has(event.key)) commit();
          }}
        />
      </div>
      <span className='glossa-progress-value' aria-hidden='true'>
        {disabled ? '—' : `${Math.round(preview)}%`}
      </span>
    </div>
  );
};

export default ProgressSlider;
