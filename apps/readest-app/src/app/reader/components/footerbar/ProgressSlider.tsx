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
  const lastCommit = useRef<number | null>(null);
  const cancelled = useRef(false);
  const interaction = useRef<{
    start: number;
    pointerId?: number;
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
    cancelled.current = true;
    releasePointer();
    setPreview(value);
  };

  const commit = () => {
    const draft = interaction.current;
    if (cancelled.current) {
      releasePointer();
      setPreview(value);
      return;
    }
    const next = Number(inputRef.current?.value);
    const start = draft?.start ?? Math.round(value * 10) / 10;
    releasePointer();
    if (next !== start && next !== lastCommit.current) {
      lastCommit.current = next;
      onCommit(next);
    }
  };

  // React maps range onChange to continuous input events. Native change is
  // the release boundary even if the native thumb takes pointer capture, or
  // release happens outside the input; it also handles assistive actions.
  const commitRef = useRef(commit);
  commitRef.current = commit;
  useEffect(() => {
    const input = inputRef.current;
    const handleChange = () => {
      if (interaction.current && interaction.current.pointerId === undefined) return;
      commitRef.current();
    };
    input?.addEventListener('change', handleChange);
    return () => input?.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    if (!active || disabled) {
      cancelled.current = true;
      releasePointer();
      inputRef.current?.blur();
    } else if (!interaction.current) {
      cancelled.current = false;
      lastCommit.current = null;
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
            if (cancelled.current) {
              // Escape ends the preview, but a held pointer/key can still emit input.
              event.currentTarget.value = String(value);
              setPreview(value);
              return;
            }
            const next = Number(event.currentTarget.value);
            setPreview(next);
          }}
          onPointerDown={(event) => {
            if (event.button > 0 || disabled) return;
            cancelled.current = false;
            lastCommit.current = null;
            interaction.current = {
              start: Math.round(Number(event.currentTarget.value) * 10) / 10,
              pointerId: event.pointerId,
            };
            // Leave native range in control of its drag. Native change also
            // covers release when the pointer ends outside this input.
            setScrubbing(true);
          }}
          onPointerUp={commit}
          onPointerCancel={cancel}
          onBlur={() => {
            if (interaction.current) cancel();
          }}
          // Capture precedes the toolbar's native spatial-navigation listener.
          onKeyDownCapture={(event) => {
            event.stopPropagation();
            if (event.key === 'Escape') {
              event.preventDefault();
              cancelled.current = true;
              setPreview(value);
            } else if (rangeKeys.has(event.key) && !interaction.current) {
              cancelled.current = false;
              lastCommit.current = null;
              interaction.current = {
                start: Math.round(Number(event.currentTarget.value) * 10) / 10,
              };
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
