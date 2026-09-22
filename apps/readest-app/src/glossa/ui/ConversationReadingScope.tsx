import { Citation } from '@/components/GlossaIcons';
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
    <button
      type='button'
      role='switch'
      aria-label={_('Citations')}
      title={_('Citations')}
      aria-checked={enabled}
      className='glossa-chat-citation-toggle'
      disabled={disabled}
      onClick={() => onChange(!enabled)}
    >
      <Citation size={18} />
    </button>
  );
}
