import React, { useEffect, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import {
  BoxedList,
  SectionTitle,
  SettingsInput,
  SettingsRow,
} from '@/components/settings/primitives';
import {
  CONVERSATION_PROMPTS_EVENT,
  deleteConversationPrompt,
  getConversationPromptState,
  PromptError,
  saveConversationPrompt,
  type ConversationPromptState,
} from '../conversation/prompts';

const PromptSettingsPanel: React.FC = () => {
  const _ = useTranslation();
  const [state, setState] = useState<ConversationPromptState>(getConversationPromptState);
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const [confirmDelete, setConfirmDelete] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const refresh = () => setState(getConversationPromptState());
    window.addEventListener(CONVERSATION_PROMPTS_EVENT, refresh);
    return () => window.removeEventListener(CONVERSATION_PROMPTS_EVENT, refresh);
  }, []);

  const startEditing = (id: string | 'new') => {
    const prompt = id === 'new' ? null : state.prompts.find((item) => item.id === id);
    setEditing(id);
    setName(prompt?.name ?? '');
    setContent(prompt?.content ?? '');
    setConfirmDelete('');
    setError('');
  };

  const save = () => {
    try {
      saveConversationPrompt({
        id: editing === 'new' ? undefined : (editing ?? undefined),
        name,
        content,
      });
      setEditing(null);
      setError('');
    } catch (cause) {
      setError(
        cause instanceof PromptError
          ? cause.message
          : _('Prompts could not be saved on this device.'),
      );
    }
  };

  const remove = (id: string) => {
    if (confirmDelete !== id) {
      setConfirmDelete(id);
      return;
    }
    try {
      deleteConversationPrompt(id);
      if (editing === id) setEditing(null);
      setConfirmDelete('');
      setError('');
    } catch (cause) {
      setError(
        cause instanceof PromptError
          ? cause.message
          : _('Prompts could not be saved on this device.'),
      );
    }
  };

  return (
    <div className='my-4 w-full space-y-5' onKeyDown={(event) => event.stopPropagation()}>
      <SectionTitle>{_('Prompts')}</SectionTitle>

      {state.prompts.length > 0 && (
        <BoxedList>
          {state.prompts.map((prompt) => (
            <SettingsRow key={prompt.id} label={prompt.name}>
              <div className='flex shrink-0 items-center gap-1'>
                <button
                  type='button'
                  className='glossa-button eink-bordered text-xs'
                  onClick={() => startEditing(prompt.id)}
                >
                  {_('Edit')}
                </button>
                <button
                  type='button'
                  className='glossa-button eink-bordered text-xs'
                  onClick={() => remove(prompt.id)}
                >
                  {confirmDelete === prompt.id ? _('Delete?') : _('Delete')}
                </button>
              </div>
            </SettingsRow>
          ))}
        </BoxedList>
      )}

      {editing === null ? (
        <button
          type='button'
          className='glossa-button glossa-button-primary btn-contrast'
          onClick={() => startEditing('new')}
        >
          {_('New prompt')}
        </button>
      ) : (
        <>
          <BoxedList>
            <SettingsRow label={_('Name')} asLabel>
              <SettingsInput
                aria-label={_('Name')}
                value={name}
                maxLength={60}
                onChange={(event) => setName(event.target.value)}
              />
            </SettingsRow>
            <SettingsRow label={_('Prompt')} className='flex-col !items-stretch gap-1 py-3' asLabel>
              <textarea
                aria-label={_('Prompt')}
                className='textarea settings-content bg-base-200/60 h-40 w-full rounded-md border-0 p-3 text-sm !outline-none'
                value={content}
                maxLength={8000}
                onChange={(event) => setContent(event.target.value)}
              />
            </SettingsRow>
          </BoxedList>
          <div className='flex flex-wrap items-center gap-2'>
            <button
              type='button'
              className='glossa-button glossa-button-primary btn-contrast'
              onClick={save}
            >
              {_('Save')}
            </button>
            <button
              type='button'
              className='glossa-button eink-bordered'
              onClick={() => {
                setEditing(null);
                setError('');
              }}
            >
              {_('Cancel')}
            </button>
          </div>
        </>
      )}
      {error && (
        <p role='alert' className='text-error text-sm leading-relaxed'>
          {_(error)}
        </p>
      )}
    </div>
  );
};

export default PromptSettingsPanel;
