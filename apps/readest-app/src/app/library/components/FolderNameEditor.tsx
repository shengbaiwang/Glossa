import { useEffect, useRef, useState } from 'react';
import { Check, X } from '@/components/GlossaIcons';
import { useTranslation } from '@/hooks/useTranslation';

export default function FolderNameEditor({
  initialName = '',
  onSave,
  onCancel,
}: {
  initialName?: string;
  onSave: (name: string) => Promise<boolean>;
  onCancel: () => void;
}) {
  const _ = useTranslation();
  const [name, setName] = useState(initialName);
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLInputElement>(null);
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
      onSubmit={async (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (saving || !name.trim()) return;
        setSaving(true);
        const saved = await onSave(name);
        setSaving(false);
        if (saved) onCancel();
        else input.current?.focus();
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape' && !saving) {
          event.preventDefault();
          onCancel();
        }
      }}
    >
      <input
        ref={input}
        aria-label={_('Folder name')}
        placeholder={_('Folder name')}
        value={name}
        maxLength={120}
        disabled={saving}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault();
        }}
      />
      <button
        type='submit'
        className='glossa-icon-button'
        aria-label={_('Save')}
        disabled={saving || !name.trim()}
      >
        <Check size={16} />
      </button>
      <button
        type='button'
        className='glossa-icon-button'
        aria-label={_('Cancel')}
        disabled={saving}
        onClick={onCancel}
      >
        <X size={16} />
      </button>
    </form>
  );
}
