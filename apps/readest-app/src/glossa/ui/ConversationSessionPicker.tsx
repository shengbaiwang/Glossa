import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from '@/components/GlossaIcons';
import { useTranslation } from '@/hooks/useTranslation';
import type { ConversationTurn } from '@/glossa/conversation/schema';

export interface SessionItem {
  id: string;
  title?: string;
  turns: ConversationTurn[];
}
/** Title wins over the first-question label; an empty session is "New conversation". */
export const sessionLabel = (
  session: { title?: string; turns: ConversationTurn[] },
  fallback: string,
) => session.title || session.turns[0]?.question.slice(0, 48) || fallback;

interface Props {
  sessions: SessionItem[];
  activeId: string;
  disabled?: boolean;
  onSelect: (id: string) => void;
}
export default function ConversationSessionPicker({
  sessions,
  activeId,
  disabled,
  onSelect,
}: Props) {
  const _ = useTranslation();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  const active = sessions.find((session) => session.id === activeId);
  const label = active
    ? sessionLabel(active, _('New conversation'))
    : sessions.length
      ? _('New conversation')
      : _('Loading…');
  return (
    <div
      className='glossa-chat-session-picker'
      ref={root}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation();
          close();
        }
      }}
    >
      <button
        ref={trigger}
        type='button'
        className='glossa-chat-session-trigger'
        aria-label={_('Conversation history')}
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        <span>{label}</span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div
          className='glossa-chat-session-menu eink-bordered'
          role='dialog'
          aria-label={_('Conversation history')}
        >
          {sessions
            .slice()
            .reverse()
            .map((session) => {
              const title = sessionLabel(session, _('New conversation'));
              const preview = session.title ? session.turns[0]?.question.slice(0, 60) : '';
              return (
                <button
                  type='button'
                  key={session.id}
                  onClick={() => {
                    onSelect(session.id);
                    close();
                  }}
                >
                  <span className='glossa-chat-session-text'>
                    <span className='glossa-chat-session-title'>{title}</span>
                    {preview ? (
                      <span className='glossa-chat-session-preview'>{preview}</span>
                    ) : null}
                  </span>
                  {session.id === activeId && <Check size={14} />}
                </button>
              );
            })}
        </div>
      )}
    </div>
  );
}
