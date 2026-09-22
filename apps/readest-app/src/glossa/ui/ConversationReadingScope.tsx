import { BookOpen } from '@/components/GlossaIcons';
import { useTranslation } from '@/hooks/useTranslation';

/** Permission only: choosing evidence belongs to the reading harness. */
export default function ConversationReadingScope({
  enabled,
  disabled = false,
  onChange,
}: {
  enabled: boolean;
  disabled?: boolean;
  onChange: (enabled: boolean) => void;
}) {
  const _ = useTranslation();
  return (
    <div className='glossa-chat-reading'>
      <button
        type='button'
        role='switch'
        aria-checked={enabled}
        className='glossa-chat-text-button'
        disabled={disabled}
        onClick={() => onChange(!enabled)}
      >
        <BookOpen size={15} />
        <span>{_(enabled ? 'Citations on' : 'Citations off')}</span>
      </button>
    </div>
  );
}
