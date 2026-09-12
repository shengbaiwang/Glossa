import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, SlidersHorizontal } from '@/components/GlossaIcons';
import { useTranslation } from '@/hooks/useTranslation';
import {
  CONVERSATION_PROMPTS_EVENT,
  getConversationPromptState,
  selectConversationPrompt,
  type ConversationPromptState,
} from '@/glossa/conversation/prompts';

interface Props {
  openSettings: () => void;
}
export default function ConversationPromptPicker({ openSettings }: Props) {
  const _ = useTranslation();
  const [state, setState] = useState<ConversationPromptState>(getConversationPromptState);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const active = state.prompts.find((prompt) => prompt.id === state.activeId) ?? null;
  useEffect(() => {
    const refresh = () => setState(getConversationPromptState());
    window.addEventListener(CONVERSATION_PROMPTS_EVENT, refresh);
    return () => window.removeEventListener(CONVERSATION_PROMPTS_EVENT, refresh);
  }, []);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (e.target instanceof Node && !root.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  if (!state.prompts.length) return null;
  const choose = (id: string | null) => {
    selectConversationPrompt(id);
    setOpen(false);
    trigger.current?.focus();
  };
  return (
    <div
      className='glossa-chat-prompt-picker'
      ref={root}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        }
      }}
    >
      <button
        ref={trigger}
        type='button'
        className='glossa-chat-model'
        aria-label={_('Choose prompt')}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span>{active?.name ?? _('No prompt')}</span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div
          className='glossa-chat-model-menu eink-bordered'
          role='dialog'
          aria-label={_('Choose prompt')}
        >
          <div className='glossa-chat-model-options'>
            <button type='button' onClick={() => choose(null)}>
              <span>{_('No prompt')}</span>
              {!active && <Check size={15} />}
            </button>
            {state.prompts.map((prompt) => (
              <button type='button' key={prompt.id} onClick={() => choose(prompt.id)}>
                <span>{prompt.name}</span>
                {prompt.id === active?.id && <Check size={15} />}
              </button>
            ))}
          </div>
          <button
            type='button'
            className='glossa-chat-manage-models'
            onClick={() => {
              setOpen(false);
              openSettings();
            }}
          >
            <SlidersHorizontal size={15} />
            {_('Prompt settings')}
          </button>
        </div>
      )}
    </div>
  );
}
