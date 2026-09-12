import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  ArrowUp,
  Check,
  Copy,
  MessageCircle,
  Plus,
  Redo2,
  Square,
  Trash2,
} from '@/components/GlossaIcons';
import { useTranslation } from '@/hooks/useTranslation';
import { useBookProgress } from '@/store/readerProgressStore';
import { useSettingsStore } from '@/store/settingsStore';
import type { Book } from '@/types/book';
import type { BookDoc } from '@/libs/document';
import {
  getActiveProviderConfig,
  getProviderStatus,
  MODEL_SETTINGS_EVENT,
  ModelServiceError,
  type ProviderConfig,
} from '@/glossa/ai/provider';
import {
  ConversationError,
  CONVERSATION_PROMPT_VERSION,
  type ChatIdentity,
  type ConversationTurn,
} from '@/glossa/conversation/schema';
import { generateConversation } from '@/glossa/conversation/generate';
import {
  appendConversationTurn,
  hasUnsavedConversations,
  loadConversations,
  saveConversations,
  type ConversationHistory,
} from '@/glossa/conversation/store';
import { chapterPathForHref } from '@/glossa/context/chapters';
import { writeTextToClipboard } from '@/utils/clipboard';
import ConversationModelPicker from './ConversationModelPicker';

interface Props {
  book: Book;
  bookDoc: BookDoc;
  bookKey: string;
}
const drafts = new Map<string, string>();
const initialSessions = new Map<string, string>();
const newSession = () => ({ id: crypto.randomUUID(), turns: [] as ConversationTurn[] });
const errorMessage = (cause: unknown, fallback: string) =>
  cause instanceof ConversationError || cause instanceof ModelServiceError
    ? cause.message
    : fallback;
function Answer({ text }: { text: string }) {
  return (
    <div className='glossa-chat-answer' dir='auto'>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Remote images must not create requests as a side effect of displaying a reply.
          img: ({ alt }) => <span>{alt}</span>,
          a: ({ children, href }) => (
            <a href={href} target='_blank' rel='noopener noreferrer'>
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
export default function ConversationPanel(props: Props) {
  return <ConversationBook key={`${props.book.hash}:${props.bookKey}`} {...props} />;
}
function ConversationBook({ book, bookDoc, bookKey }: Props) {
  const _ = useTranslation();
  const progress = useBookProgress(bookKey);
  const sectionPath = useMemo(
    () => (book.format === 'EPUB' ? chapterPathForHref(bookDoc, progress?.sectionHref) : ''),
    [book.format, bookDoc, progress?.sectionHref],
  );
  const metadata: ChatIdentity = {
    bookTitle: (book.title ?? '').slice(0, 500),
    author: (book.author ?? '').slice(0, 500),
    chapterTitle: (sectionPath || progress?.sectionLabel || '').slice(0, 500),
  };
  const [history, setHistory] = useState<ConversationHistory | null>(null);
  const historyRef = useRef(history);
  const [historyError, setHistoryError] = useState('');
  const [loadRevision, setLoadRevision] = useState(0);
  const [saveError, setSaveError] = useState(false);
  const [draft, setDraft] = useState('');
  const draftBeforeLoad = useRef('');
  const [config, setConfig] = useState<ProviderConfig | null>(null);
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState<{ question: string; text: string } | null>(null);
  const [error, setError] = useState('');
  const [failedQuestion, setFailedQuestion] = useState('');
  const [copied, setCopied] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const request = useRef<AbortController | null>(null);
  const stopRequest = useRef<(() => void) | null>(null);
  const mounted = useRef(true);
  const composer = useRef<HTMLTextAreaElement>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const busy = pending !== null;
  const turns = history?.sessions.find((s) => s.id === history.activeId)?.turns ?? [];
  const draftKey = (id: string) => `${book.hash}:${id}`;
  const updateDraft = (value: string) => {
    setDraft(value);
    draftBeforeLoad.current = value;
    if (historyRef.current) drafts.set(draftKey(historyRef.current.activeId), value);
  };
  const persist = (next: ConversationHistory) => {
    historyRef.current = next;
    if (mounted.current) {
      setHistory(next);
      setSaveError(false);
    }
    try {
      void saveConversations(next)
        .then(() => {
          if (mounted.current) setSaveError(hasUnsavedConversations(book.hash));
        })
        .catch(() => {
          if (mounted.current) setSaveError(true);
        });
    } catch {
      if (mounted.current) setSaveError(true);
    }
  };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stopRequest.current?.();
    };
  }, []);
  useEffect(() => {
    let active = true;
    setHistoryError('');
    void loadConversations(book.hash)
      .then((saved) => {
        if (!active) return;
        const session = newSession();
        session.id = initialSessions.get(book.hash) ?? session.id;
        initialSessions.set(book.hash, session.id);
        const next = saved ?? {
          version: 1 as const,
          bookId: book.hash,
          sessions: [session],
          activeId: session.id,
        };
        historyRef.current = next;
        setHistory(next);
        const restoredDraft = draftBeforeLoad.current || drafts.get(draftKey(next.activeId)) || '';
        setDraft(restoredDraft);
        drafts.set(draftKey(next.activeId), restoredDraft);
        setSaveError(hasUnsavedConversations(book.hash));
      })
      .catch((cause: unknown) => {
        if (active) setHistoryError(errorMessage(cause, 'Conversations could not be loaded.'));
      });
    return () => {
      active = false;
    };
  }, [book.hash, loadRevision]);
  useEffect(() => {
    let active = true,
      sequence = 0;
    const refresh = async () => {
      const ticket = ++sequence;
      stopRequest.current?.();
      const next = getActiveProviderConfig();
      setConfig(next);
      setReady(false);
      if (!next) return;
      try {
        const status = await getProviderStatus(next);
        if (active && ticket === sequence) {
          setReady(status.configured);
          setError('');
        }
      } catch (cause) {
        if (active && ticket === sequence)
          setError(errorMessage(cause, 'The model service could not be checked.'));
      }
    };
    void refresh();
    window.addEventListener(MODEL_SETTINGS_EVENT, refresh);
    return () => {
      active = false;
      window.removeEventListener(MODEL_SETTINGS_EVENT, refresh);
    };
  }, []);
  useEffect(() => {
    if (atBottom && transcript.current)
      transcript.current.scrollTop = transcript.current.scrollHeight;
  }, [turns.length, pending?.text, busy, atBottom]);
  useEffect(() => {
    const input = composer.current;
    if (input) {
      input.style.height = 'auto';
      input.style.height = `${Math.min(180, Math.max(76, input.scrollHeight))}px`;
    }
  }, [draft]);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(''), 1800);
    return () => clearTimeout(timer);
  }, [copied]);
  const openModels = () => {
    const settings = useSettingsStore.getState();
    settings.setSettingsDialogBookKey(bookKey);
    settings.setRequestedPanel('Models');
    settings.setSettingsDialogOpen(true);
  };
  const send = async (retryIndex?: number, retryQuestion?: string) => {
    const current = historyRef.current;
    const question =
      retryIndex === undefined
        ? (retryQuestion ?? draft.trim())
        : (turns[retryIndex]?.question ?? '');
    if (
      request.current ||
      !current ||
      !config ||
      !ready ||
      !question ||
      (turns.length >= 40 && retryIndex === undefined)
    )
      return;
    const controller = new AbortController();
    request.current = controller;
    const sessionId = current.activeId;
    const id = crypto.randomUUID();
    const before = retryIndex === undefined ? turns : turns.slice(0, retryIndex);
    const snapshot = { ...metadata };
    let text = '',
      settled = false;
    const finish = (status: 'complete' | 'stopped' | 'failed') => {
      if (settled) return;
      settled = true;
      request.current = null;
      stopRequest.current = null;
      if (text.trim()) {
        const turn: ConversationTurn = {
          id,
          question,
          blocks: [{ kind: 'background', text, sourceIds: [] }],
          sources: [],
          createdAt: Date.now(),
          provider: config,
          promptVersion: CONVERSATION_PROMPT_VERSION,
          metadata: snapshot,
          status,
        };
        const latest = historyRef.current;
        if (latest && latest.activeId === sessionId) {
          if (retryIndex === undefined) persist(appendConversationTurn(latest, turn));
          else
            persist({
              ...latest,
              sessions: latest.sessions.map((s) =>
                s.id === sessionId
                  ? { ...s, turns: s.turns.map((old, i) => (i === retryIndex ? turn : old)) }
                  : s,
              ),
            });
        }
      } else if (retryIndex === undefined && !drafts.get(draftKey(sessionId))?.trim()) {
        drafts.set(draftKey(sessionId), question);
        if (mounted.current) updateDraft(question);
      }
      if (mounted.current) {
        setPending(null);
        composer.current?.focus();
      }
    };
    stopRequest.current = () => {
      controller.abort();
      finish('stopped');
    };
    setPending({ question, text: '' });
    setError('');
    setFailedQuestion('');
    setAtBottom(true);
    setDeleting(false);
    if (retryIndex === undefined && (!retryQuestion || draft.trim() === retryQuestion))
      updateDraft('');
    try {
      const answer = await generateConversation({
        metadata: snapshot,
        question,
        turns: before,
        config,
        signal: controller.signal,
        onText: (value) => {
          if (!controller.signal.aborted && mounted.current && !settled) {
            text = value;
            setPending({ question, text });
          }
        },
      });
      if (controller.signal.aborted || settled) return;
      text = answer;
      finish('complete');
    } catch (cause) {
      if (settled) return;
      if (controller.signal.aborted) finish('stopped');
      else {
        // Failed retries leave the previous valid answer intact.
        if (retryIndex !== undefined) text = '';
        if (mounted.current && retryIndex === undefined && !text.trim())
          setFailedQuestion(question);
        finish('failed');
        if (mounted.current)
          setError(errorMessage(cause, 'The reply could not be completed. Try again.'));
      }
    }
  };
  const changeSession = (id?: string) => {
    stopRequest.current?.();
    const current = historyRef.current;
    if (!current) return;
    let next = current;
    if (id) next = { ...current, activeId: id };
    else {
      const empty = current.sessions.find(
        (s) => !s.turns.length && !drafts.get(draftKey(s.id))?.trim(),
      );
      if (empty) next = { ...current, activeId: empty.id };
      else if (current.sessions.length >= 20) {
        setError('This book has 20 conversations. Delete a conversation before starting another.');
        return;
      } else {
        const session = newSession();
        next = { ...current, activeId: session.id, sessions: [...current.sessions, session] };
      }
    }
    persist(next);
    setDraft(drafts.get(draftKey(next.activeId)) ?? '');
    setError('');
    setFailedQuestion('');
    setDeleting(false);
    setAtBottom(true);
    composer.current?.focus();
  };
  const deleteSession = () => {
    stopRequest.current?.();
    const current = historyRef.current;
    if (!current) return;
    const sessions = current.sessions.filter((s) => s.id !== current.activeId);
    if (!sessions.length) sessions.push(newSession());
    drafts.delete(draftKey(current.activeId));
    const next = { ...current, sessions, activeId: sessions.at(-1)!.id };
    persist(next);
    setDraft(drafts.get(draftKey(next.activeId)) ?? '');
    setDeleting(false);
    setError('');
    setFailedQuestion('');
    setAtBottom(true);
    composer.current?.focus();
  };
  const canSend = Boolean(history && ready && config && draft.trim() && !busy && turns.length < 40);
  return (
    <section
      className='glossa-chat-panel'
      aria-label={_('Conversation')}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className='glossa-chat-toolbar'>
        <select
          aria-label={_('Conversation history')}
          value={history?.activeId ?? ''}
          disabled={!history}
          onChange={(e) => changeSession(e.target.value)}
        >
          {!history && <option value=''>{_('Loading…')}</option>}
          {history?.sessions
            .slice()
            .reverse()
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.turns[0]?.question.slice(0, 48) || _('New conversation')}
              </option>
            ))}
        </select>
        <button
          type='button'
          className='glossa-chat-text-button'
          aria-label={_('New conversation')}
          title={_('New conversation')}
          disabled={!history}
          onClick={() => changeSession()}
        >
          <Plus size={18} />
        </button>
        <button
          type='button'
          className='glossa-chat-text-button'
          aria-label={_('Delete conversation')}
          title={_('Delete conversation')}
          disabled={!history || (!turns.length && history.sessions.length === 1)}
          onClick={() => setDeleting(!deleting)}
        >
          <Trash2 size={16} />
        </button>
      </div>
      {deleting && (
        <div className='glossa-chat-message' role='alert'>
          {_('Delete this conversation?')}
          <button type='button' onClick={() => setDeleting(false)}>
            {_('Cancel')}
          </button>
          <button type='button' onClick={deleteSession}>
            {_('Delete')}
          </button>
        </div>
      )}
      {historyError && (
        <div className='glossa-chat-message' role='alert'>
          {_(historyError)}
          <button type='button' onClick={() => setLoadRevision((n) => n + 1)}>
            {_('Retry')}
          </button>
        </div>
      )}
      {saveError && (
        <div className='glossa-chat-message' role='alert'>
          {_('Conversation not saved.')}
          <button
            type='button'
            onClick={() => {
              if (historyRef.current) persist(historyRef.current);
            }}
          >
            {_('Retry saving')}
          </button>
        </div>
      )}
      <div
        className='glossa-chat-transcript'
        ref={transcript}
        onScroll={(e) => {
          const el = e.currentTarget;
          setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 64);
        }}
      >
        {!turns.length && !busy && (
          <div className='glossa-chat-welcome'>
            <MessageCircle size={28} />
            <h3>{_('New conversation')}</h3>
            {!ready && config !== null && (
              <button className='glossa-button' type='button' onClick={openModels}>
                {_('Set up a model')}
              </button>
            )}
          </div>
        )}
        {turns.map((turn, index) => (
          <article className='glossa-chat-turn' key={turn.id}>
            <div className='glossa-chat-question eink-bordered' dir='auto'>
              {turn.question}
            </div>
            <Answer text={turn.blocks.map((b) => b.text).join('\n\n')} />
            <div className='glossa-chat-answer-actions'>
              <span title={turn.provider.name}>{turn.provider.model}</span>
              {turn.promptVersion === CONVERSATION_PROMPT_VERSION && turn.status !== 'complete' && (
                <span>{_(turn.status === 'stopped' ? 'Stopped' : 'Reply interrupted')}</span>
              )}
              <button
                type='button'
                className='glossa-chat-text-button'
                aria-label={_('Copy reply')}
                title={_('Copy reply')}
                onClick={() => {
                  void writeTextToClipboard(turn.blocks.map((b) => b.text).join('\n\n'))
                    .then(() => {
                      if (mounted.current) setCopied(turn.id);
                    })
                    .catch(() => {
                      if (mounted.current) setError('The reply could not be copied.');
                    });
                }}
              >
                {copied === turn.id ? <Check size={14} /> : <Copy size={14} />}
              </button>
              {index === turns.length - 1 && (
                <button
                  type='button'
                  className='glossa-chat-text-button'
                  aria-label={_('Regenerate reply')}
                  title={_('Regenerate reply')}
                  disabled={busy || !ready}
                  onClick={() => void send(index)}
                >
                  <Redo2 size={15} />
                </button>
              )}
            </div>
          </article>
        ))}
        {pending && (
          <article className='glossa-chat-turn'>
            <div className='glossa-chat-question eink-bordered' dir='auto'>
              {pending.question}
            </div>
            <Answer text={pending.text} />
            <span className='glossa-chat-pending' role='status' aria-label={_('Replying…')}>
              •••
            </span>
          </article>
        )}
      </div>
      {!atBottom && (
        <button className='glossa-chat-latest' type='button' onClick={() => setAtBottom(true)}>
          {_('Latest reply')}
        </button>
      )}
      {error && (
        <p className='glossa-chat-message' role='alert'>
          {_(error)}
          {failedQuestion && (
            <button
              type='button'
              aria-label={_('Retry reply')}
              disabled={!ready || busy}
              onClick={() => void send(undefined, failedQuestion)}
            >
              {_('Retry')}
            </button>
          )}
        </p>
      )}
      <div className='glossa-chat-composer-wrap'>
        {turns.length >= 40 && (
          <button className='glossa-button' type='button' onClick={() => changeSession()}>
            {_('New conversation')}
          </button>
        )}
        <form
          className='glossa-chat-composer eink-bordered'
          onSubmit={(e) => {
            e.preventDefault();
            if (canSend) void send();
          }}
        >
          <textarea
            ref={composer}
            aria-label={_('Message')}
            placeholder={_('Message…')}
            value={draft}
            maxLength={2000}
            rows={3}
            onChange={(e) => updateDraft(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === 'Enter' &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing &&
                e.nativeEvent.keyCode !== 229
              ) {
                e.preventDefault();
                if (canSend) void send();
              }
            }}
          />
          <div className='glossa-chat-composer-footer'>
            <ConversationModelPicker config={config} ready={ready} openSettings={openModels} />
            {busy ? (
              <button
                type='button'
                className='glossa-chat-send btn-contrast'
                aria-label={_('Stop reply')}
                onClick={() => stopRequest.current?.()}
              >
                <Square size={15} />
              </button>
            ) : (
              <button
                type='submit'
                className='glossa-chat-send btn-contrast'
                disabled={!canSend}
                aria-label={_('Send message')}
              >
                <ArrowUp size={18} />
              </button>
            )}
          </div>
        </form>
      </div>
    </section>
  );
}
