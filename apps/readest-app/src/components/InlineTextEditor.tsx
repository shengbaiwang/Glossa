import { useCallback, useRef, useState } from 'react';

/** Content stays in place; Enter/blur saves, Escape cancels, IME never submits. */
export default function InlineTextEditor({
  value,
  label,
  onSave,
  className = '',
  activateOnClick = false,
  placeholder = '',
  displayText,
}: {
  value: string;
  label: string;
  onSave: (value: string) => Promise<boolean>;
  className?: string;
  activateOnClick?: boolean;
  placeholder?: string;
  displayText?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const pending = useRef(false);
  const finished = useRef(false);
  const composing = useRef(false);
  const attachInput = useCallback((element: HTMLInputElement | null) => {
    input.current = element;
    if (element) {
      element.focus();
      element.select();
    }
  }, []);
  const trigger = useRef<HTMLSpanElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const begin = () => {
    setDraft(value);
    setFailed(false);
    finished.current = false;
    setEditing(true);
  };
  const close = (focus: boolean) => {
    finished.current = true;
    setEditing(false);
    if (focus) requestAnimationFrame(() => trigger.current?.focus());
  };
  const commit = async (focus: boolean, text = draft) => {
    if (pending.current || finished.current || composing.current) return;
    if (text === value) {
      close(focus);
      return;
    }
    pending.current = true;
    setSaving(true);
    setFailed(false);
    try {
      if (await onSave(text)) close(focus);
      else {
        setFailed(true);
        if (focus) input.current?.focus();
      }
    } catch {
      setFailed(true);
      if (focus) input.current?.focus();
    } finally {
      pending.current = false;
      setSaving(false);
    }
  };
  return editing ? (
    <form
      className={`glossa-inline-editor ${className}`}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void commit(true);
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (composing.current || e.nativeEvent.isComposing || e.keyCode === 229) {
          if (e.key === 'Enter') e.preventDefault();
          return;
        }
        if (e.key === 'Escape' && !pending.current) {
          e.preventDefault();
          close(true);
        }
      }}
    >
      <input
        ref={attachInput}
        aria-label={label}
        value={draft}
        readOnly={saving}
        aria-busy={saving}
        aria-invalid={failed || undefined}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit(false)}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={(e) => {
          composing.current = false;
          if (document.activeElement !== input.current) void commit(false, e.currentTarget.value);
        }}
      />
    </form>
  ) : (
    <span
      ref={trigger}
      data-inline-edit
      role='button'
      tabIndex={0}
      aria-label={label}
      className={`glossa-inline-value ${className}`}
      onPointerDown={(e) => {
        if (!e.metaKey && !e.ctrlKey && !e.shiftKey) e.stopPropagation();
      }}
      onPointerUp={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        if (activateOnClick) begin();
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        begin();
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter' || e.key === 'F2') {
          e.preventDefault();
          begin();
        }
      }}
    >
      {displayText ?? (value || placeholder)}
    </span>
  );
}
