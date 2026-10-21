import { useEffect, useRef, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';

export default function FolderNameEditor({
  initialName = '',
  onSave,
  onCancel,
}: {
  initialName?: string;
  onSave: (name: string) => Promise<boolean>;
  onCancel: (restoreFocus?: boolean) => void;
}) {
  const _ = useTranslation();
  const [name, setName] = useState(initialName);
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const pending = useRef(false);
  const finished = useRef(false);
  const composing = useRef(false);
  const commit = async (restoreFocus: boolean, value = name) => {
    if (pending.current || finished.current || composing.current) return;
    pending.current = true;
    setSaving(true);
    try {
      if (await onSave(value)) {
        finished.current = true;
        onCancel(restoreFocus);
      } else if (restoreFocus) input.current?.focus();
    } finally {
      pending.current = false;
      setSaving(false);
    }
  };
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  return (
    <form
      className='glossa-folder-name-editor'
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void commit(true);
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === 'Escape' && !saving) {
          event.preventDefault();
          finished.current = true;
          onCancel(true);
        }
      }}
    >
      <input
        ref={input}
        aria-label={_('Group name')}
        placeholder={_('Untitled')}
        value={name}
        maxLength={120}
        readOnly={saving}
        aria-busy={saving}
        onBlur={() => void commit(false)}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={(event) => {
          composing.current = false;
          if (document.activeElement !== input.current)
            void commit(false, event.currentTarget.value);
        }}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (
            event.key === 'Enter' &&
            (composing.current || event.nativeEvent.isComposing || event.keyCode === 229)
          )
            event.preventDefault();
        }}
      />
    </form>
  );
}
