import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  ArrowUp,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  MessageCircle,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Square,
  Trash2,
  Ellipsis,
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
  providerCapabilities,
  providerIdentity,
  saveProviderConfig,
  type ProviderConfig,
  type ReasoningEffort,
} from '@/glossa/ai/provider';
import {
  addAnswerVersion,
  chatTurnFrom,
  ConversationError,
  CONVERSATION_PROMPT_VERSION,
  currentAnswerVersion,
  MAX_QUESTION_CHARS,
  MAX_TURN_VERSIONS,
  selectAnswerVersion,
  type ChatIdentity,
  type ConversationTurn,
} from '@/glossa/conversation/schema';
import { generateConversation, generateConversationTitle } from '@/glossa/conversation/generate';
import {
  CONVERSATION_PROMPTS_EVENT,
  getActiveConversationPrompt,
} from '@/glossa/conversation/prompts';
import {
  appendConversationTurn,
  hasUnsavedConversations,
  loadConversations,
  saveConversations,
  waitForConversationSave,
  type ConversationHistory,
} from '@/glossa/conversation/store';
import { chapterPathForHref } from '@/glossa/context/chapters';
import {
  conversationFontPx,
  CONVERSATION_FONT_SIZES,
  getConversationFontSize,
  setConversationFontSize,
  type ConversationFontSize,
} from '@/glossa/conversation/display';
import { writeTextToClipboard } from '@/utils/clipboard';
import { renderAnswerHtml } from './answerMarkdown';
import ConversationModelPicker from './ConversationModelPicker';
import ConversationPromptPicker from './ConversationPromptPicker';

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
const COPY_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M6.5 15H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v.5"/></svg>';
const CHECK_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
function Answer({ text }: { text: string }) {
  const _ = useTranslation();
  const translate = useRef(_);
  translate.current = _;
  const root = useRef<HTMLDivElement>(null);
  // Keep this object stable so React does not replace the enhanced code blocks
  // when the composer or conversation menu rerenders the parent.
  const markup = useMemo(() => ({ __html: renderAnswerHtml(text) }), [text]);
  const copyError = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const container = root.current;
    if (!container) return;
    const timers = new Set<number>();
    container.querySelectorAll('a[href]').forEach((anchor) => {
      anchor.setAttribute('target', '_blank');
      anchor.setAttribute('rel', 'noopener noreferrer');
    });
    for (const pre of Array.from(container.querySelectorAll('pre'))) {
      if (pre.parentElement?.classList.contains('glossa-chat-code')) continue;
      const wrap = document.createElement('div');
      wrap.className = 'glossa-chat-code';
      pre.replaceWith(wrap);
      wrap.append(pre);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'glossa-chat-code-copy';
      button.setAttribute('aria-label', translate.current('Copy code'));
      button.setAttribute('title', translate.current('Copy code'));
      button.innerHTML = COPY_ICON;
      wrap.append(button);
    }
    const onClick = (event: Event) => {
      const button = (event.target as Element | null)?.closest('.glossa-chat-code-copy');
      if (!(button instanceof HTMLElement)) return;
      const code = button.parentElement?.querySelector('pre')?.textContent ?? '';
      if (copyError.current) copyError.current.hidden = true;
      void writeTextToClipboard(code)
        .then(() => {
          button.classList.add('is-copied');
          button.setAttribute('aria-label', translate.current('Copied'));
          button.innerHTML = CHECK_ICON;
          const timer = window.setTimeout(() => {
            timers.delete(timer);
            button.classList.remove('is-copied');
            button.setAttribute('aria-label', translate.current('Copy code'));
            button.innerHTML = COPY_ICON;
          }, 1600);
          timers.add(timer);
        })
        .catch(() => {
          if (copyError.current) copyError.current.hidden = false;
        });
    };
    container.addEventListener('click', onClick);
    return () => {
      container.removeEventListener('click', onClick);
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [markup]);
  return (
    <>
      <div className='glossa-chat-answer' dir='auto' ref={root} dangerouslySetInnerHTML={markup} />
      <p ref={copyError} hidden className='glossa-chat-message' role='alert'>
        {_('The code could not be copied.')}
      </p>
    </>
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
  const [prompt, setPrompt] = useState(() => getActiveConversationPrompt()?.content ?? '');
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState<{ question: string; text: string } | null>(null);
  const [error, setError] = useState('');
  const [failedQuestion, setFailedQuestion] = useState('');
  const [copied, setCopied] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [editTurn, setEditTurn] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [fontSize, setFontSize] = useState<ConversationFontSize>(() => getConversationFontSize());
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRoot = useRef<HTMLDivElement>(null);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const request = useRef<AbortController | null>(null);
  const stopRequest = useRef<(() => void) | null>(null);
  const titleRequest = useRef<AbortController | null>(null);
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
          if (mounted.current && !hasUnsavedConversations(book.hash)) setSaveError(false);
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
      titleRequest.current?.abort();
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
        setSaveError(false);
        void waitForConversationSave(book.hash)
          .then(() => {
            if (active) setSaveError(hasUnsavedConversations(book.hash));
          })
          .catch(() => {
            if (active) setSaveError(true);
          });
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
    const refresh = () => setPrompt(getActiveConversationPrompt()?.content ?? '');
    window.addEventListener(CONVERSATION_PROMPTS_EVENT, refresh);
    return () => window.removeEventListener(CONVERSATION_PROMPTS_EVENT, refresh);
  }, []);
  useEffect(() => {
    if (atBottom && transcript.current)
      transcript.current.scrollTop = transcript.current.scrollHeight;
  }, [turns.length, pending?.text, busy, atBottom]);
  useEffect(() => {
    const input = composer.current;
    if (!input) return;
    const resize = () => {
      input.style.height = 'auto';
      input.style.height = `${Math.min(180, Math.max(76, input.scrollHeight))}px`;
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [draft]);
  useEffect(() => {
    if (!menuOpen) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !menuRoot.current?.contains(event.target))
        setMenuOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [menuOpen]);
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
  const openPrompts = () => {
    const settings = useSettingsStore.getState();
    settings.setSettingsDialogBookKey(bookKey);
    settings.setRequestedPanel('Conversation');
    settings.setSettingsDialogOpen(true);
  };
  const capabilities = config ? providerCapabilities(config) : null;
  const effortLabels: Record<ReasoningEffort, string> = {
    none: _('None'),
    minimal: _('Minimal'),
    low: _('Low'),
    medium: _('Medium'),
    high: _('High'),
    xhigh: _('Extra high'),
    max: _('Max'),
  };
  const updateEffort = async (value: string) => {
    if (!config) return;
    try {
      await saveProviderConfig({
        ...config,
        reasoningEffort: (value || undefined) as ReasoningEffort | undefined,
      });
    } catch (cause) {
      if (mounted.current)
        setError(errorMessage(cause, 'Unable to save model settings on this device.'));
    }
  };
  /** Name an untitled session once its first reply completes; failure keeps the question label. */
  const autoTitle = (sessionId: string, question: string, answer: string, used: ProviderConfig) => {
    const current = historyRef.current;
    const session = current?.sessions.find((s) => s.id === sessionId);
    if (!current || !session || session.title || session.turns.length !== 1) return;
    titleRequest.current?.abort();
    const controller = new AbortController();
    titleRequest.current = controller;
    void generateConversationTitle({ question, answer, config: used, signal: controller.signal })
      .then((title) => {
        const latest = historyRef.current;
        const target = latest?.sessions.find((s) => s.id === sessionId);
        // A name typed meanwhile always wins over the generated one.
        if (!latest || !target || target.title || !title) return;
        persist({
          ...latest,
          sessions: latest.sessions.map((s) => (s.id === sessionId ? { ...s, title } : s)),
        });
      })
      .catch(() => {});
  };
  const send = async (options?: { versionOf?: number; question?: string }) => {
    const current = historyRef.current;
    const index = options?.versionOf;
    const regenerate = index !== undefined;
    const question = (
      options?.question ?? (regenerate ? (turns[index!]?.question ?? '') : draft.trim())
    ).trim();
    if (request.current || !current || !config || !ready || !question) return;
    if (!regenerate && turns.length >= 40) return;
    if (regenerate) {
      const turn = turns[index!];
      const count = turn ? (('versions' in turn && turn.versions) || [turn]).length : 0;
      if (!turn || count >= MAX_TURN_VERSIONS) {
        setError(
          'This reply already has the most versions. Delete the conversation to start over.',
        );
        return;
      }
    }
    const controller = new AbortController();
    request.current = controller;
    const sessionId = current.activeId;
    const id = crypto.randomUUID();
    const before = regenerate ? turns.slice(0, index) : turns;
    const snapshot = { ...metadata };
    let text = '',
      settled = false;
    const finish = (status: 'complete' | 'stopped' | 'failed') => {
      if (settled) return;
      settled = true;
      request.current = null;
      stopRequest.current = null;
      if (text.trim()) {
        const version = {
          id,
          question,
          text,
          createdAt: Date.now(),
          provider: providerIdentity(config),
          status,
        };
        const latest = historyRef.current;
        if (latest && latest.activeId === sessionId) {
          if (!regenerate) {
            const turn: ConversationTurn = {
              id,
              question,
              blocks: [{ kind: 'background', text, sourceIds: [] }],
              sources: [],
              createdAt: version.createdAt,
              provider: providerIdentity(config),
              promptVersion: CONVERSATION_PROMPT_VERSION,
              metadata: snapshot,
              status,
            };
            persist(appendConversationTurn(latest, turn));
          } else {
            persist({
              ...latest,
              sessions: latest.sessions.map((s) =>
                s.id === sessionId
                  ? {
                      ...s,
                      turns: s.turns.map((old, i) =>
                        i === index ? addAnswerVersion(chatTurnFrom(old, snapshot), version) : old,
                      ),
                    }
                  : s,
              ),
            });
          }
        }
      } else if (!regenerate && !drafts.get(draftKey(sessionId))?.trim()) {
        drafts.set(draftKey(sessionId), question);
        if (mounted.current) updateDraft(question);
      }
      if (mounted.current) {
        setPending(null);
        composer.current?.focus();
      }
      if (!regenerate && status === 'complete') autoTitle(sessionId, question, text, config);
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
    setEditTurn(null);
    if (!regenerate && (!options?.question || draft.trim() === options.question)) updateDraft('');
    try {
      const answer = await generateConversation({
        metadata: snapshot,
        question,
        turns: before,
        config,
        prompt,
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
        // Failed regenerations leave the previous valid answer intact.
        if (regenerate) text = '';
        if (mounted.current && !regenerate && !text.trim()) setFailedQuestion(question);
        finish('failed');
        if (mounted.current) {
          if (regenerate && options?.question !== undefined) {
            setEditTurn(turns[index!]!.id);
            setEditDraft(question);
          }
          setError(errorMessage(cause, 'The reply could not be completed. Try again.'));
        }
      }
    }
  };
  const switchVersion = (index: number, versionId: string) => {
    const latest = historyRef.current;
    if (!latest || busy) return;
    const sessionId = latest.activeId;
    persist({
      ...latest,
      sessions: latest.sessions.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              turns: session.turns.map((turn, i) =>
                i === index ? selectAnswerVersion(turn, versionId) : turn,
              ),
            }
          : session,
      ),
    });
  };
  const startEditing = (turn: ConversationTurn) => {
    setEditTurn(turn.id);
    setEditDraft(turn.question);
    setError('');
  };
  const sessionLabel = (session: { title?: string; turns: ConversationTurn[] }) =>
    session.title || session.turns[0]?.question.slice(0, 48) || _('New conversation');
  const startRenaming = () => {
    const active = history?.sessions.find((session) => session.id === history.activeId);
    setRenameDraft(active?.title ?? '');
    setRenaming(true);
    setSearching(false);
  };
  const saveRename = () => {
    const current = historyRef.current;
    if (!current) return;
    const title = renameDraft.trim();
    persist({
      ...current,
      sessions: current.sessions.map((session) => {
        if (session.id !== current.activeId) return session;
        const next = { ...session };
        if (title) next.title = title;
        else delete next.title;
        return next;
      }),
    });
    setRenaming(false);
  };
  const query = searchQuery.trim().toLowerCase();
  const searchResults = !query
    ? []
    : (history?.sessions ?? [])
        .map((session) => {
          const candidates = [
            session.title ?? '',
            ...session.turns.flatMap((turn) => [
              turn.question,
              turn.blocks.map((block) => block.text).join(' '),
              ...('versions' in turn
                ? (turn.versions ?? []).flatMap((version) => [version.question, version.text])
                : []),
            ]),
          ];
          const found = candidates.find((text) => text.toLowerCase().includes(query));
          if (found === undefined) return null;
          const at = found.toLowerCase().indexOf(query);
          const snippet = found
            .slice(Math.max(0, at - 24), at + query.length + 40)
            .replace(/\s+/g, ' ')
            .trim();
          return { session, snippet };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null);
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
      style={{ '--glossa-chat-answer-size': `${conversationFontPx(fontSize)}px` } as CSSProperties}
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
                {sessionLabel(s)}
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
          aria-label={_('Search conversations')}
          title={_('Search conversations')}
          aria-pressed={searching}
          disabled={!history}
          onClick={() => {
            setSearching(!searching);
            setSearchQuery('');
            setRenaming(false);
          }}
        >
          <Search size={16} />
        </button>
        <div
          className='glossa-chat-menu-picker'
          ref={menuRoot}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && menuOpen) {
              event.stopPropagation();
              setMenuOpen(false);
              menuTrigger.current?.focus();
            }
          }}
        >
          <button
            ref={menuTrigger}
            type='button'
            className='glossa-chat-text-button'
            aria-label={_('Conversation menu')}
            title={_('Conversation menu')}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((value) => !value)}
          >
            <Ellipsis size={18} />
          </button>
          {menuOpen && (
            <div
              className='glossa-chat-menu eink-bordered'
              role='dialog'
              aria-label={_('Conversation menu')}
            >
              <button
                type='button'
                className='glossa-chat-menu-option'
                disabled={!history}
                onClick={() => {
                  setMenuOpen(false);
                  startRenaming();
                }}
              >
                <Pencil size={15} />
                <span>{_('Rename conversation')}</span>
              </button>
              <fieldset className='glossa-chat-font-group'>
                <legend>{_('Text size')}</legend>
                {CONVERSATION_FONT_SIZES.map((size) => (
                  <button
                    type='button'
                    key={size.id}
                    className='glossa-chat-menu-option'
                    aria-pressed={size.id === fontSize}
                    onClick={() => {
                      setFontSize(size.id);
                      setConversationFontSize(size.id);
                      setMenuOpen(false);
                      menuTrigger.current?.focus();
                    }}
                  >
                    <span>{_(size.label)}</span>
                    {size.id === fontSize && <Check size={15} />}
                  </button>
                ))}
              </fieldset>
              <button
                type='button'
                className='glossa-chat-menu-option'
                disabled={!history || (!turns.length && history.sessions.length === 1)}
                onClick={() => {
                  setMenuOpen(false);
                  setDeleting(true);
                }}
              >
                <Trash2 size={15} />
                <span>{_('Delete conversation')}</span>
              </button>
            </div>
          )}
        </div>
      </div>
      {renaming && (
        <form
          className='glossa-chat-rename eink-bordered'
          onSubmit={(event) => {
            event.preventDefault();
            saveRename();
          }}
        >
          <input
            aria-label={_('Conversation name')}
            value={renameDraft}
            maxLength={120}
            autoFocus
            onChange={(event) => setRenameDraft(event.target.value)}
          />
          <button type='submit' className='glossa-chat-text-button'>
            {_('Save')}
          </button>
          <button
            type='button'
            className='glossa-chat-text-button'
            onClick={() => setRenaming(false)}
          >
            {_('Cancel')}
          </button>
        </form>
      )}
      {searching && (
        <div className='glossa-chat-search'>
          <input
            className='eink-bordered'
            aria-label={_('Search conversations')}
            placeholder={_('Search conversations')}
            value={searchQuery}
            maxLength={200}
            autoFocus
            onChange={(event) => setSearchQuery(event.target.value)}
          />
          {query && (
            <div className='glossa-chat-search-results'>
              {searchResults.map(({ session, snippet }) => (
                <button
                  type='button'
                  key={session.id}
                  onClick={() => {
                    changeSession(session.id);
                    setSearching(false);
                    setSearchQuery('');
                  }}
                >
                  <span className='glossa-chat-search-title'>{sessionLabel(session)}</span>
                  <span className='glossa-chat-search-snippet'>{snippet}</span>
                </button>
              ))}
              {!searchResults.length && <p className='glossa-chat-message'>{_('No matches')}</p>}
            </div>
          )}
        </div>
      )}
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
        {turns.map((turn, index) => {
          const versions =
            'versions' in turn && turn.versions ? turn.versions : [currentAnswerVersion(turn)];
          const activeIndex = versions.findIndex(
            (version) => version.id === currentAnswerVersion(turn).id,
          );
          const editing = editTurn === turn.id;
          return (
            <article className='glossa-chat-turn' key={turn.id}>
              {editing ? (
                <div className='glossa-chat-edit eink-bordered'>
                  <textarea
                    aria-label={_('Edit question')}
                    value={editDraft}
                    maxLength={MAX_QUESTION_CHARS}
                    rows={3}
                    onChange={(e) => setEditDraft(e.target.value)}
                  />
                  <div className='glossa-chat-edit-actions'>
                    <button
                      type='button'
                      className='glossa-chat-text-button'
                      onClick={() => setEditTurn(null)}
                    >
                      {_('Cancel')}
                    </button>
                    <button
                      type='button'
                      className='glossa-chat-text-button glossa-chat-edit-send'
                      disabled={busy || !editDraft.trim()}
                      onClick={() => void send({ versionOf: index, question: editDraft })}
                    >
                      {_('Resend')}
                    </button>
                  </div>
                </div>
              ) : (
                <div className='glossa-chat-question eink-bordered' dir='auto'>
                  {turn.question}
                </div>
              )}
              <Answer text={turn.blocks.map((b) => b.text).join('\n\n')} />
              <div className='glossa-chat-answer-actions'>
                <span title={turn.provider.name}>{turn.provider.model}</span>
                {turn.promptVersion === CONVERSATION_PROMPT_VERSION &&
                  turn.status !== 'complete' && (
                    <span>{_(turn.status === 'stopped' ? 'Stopped' : 'Reply interrupted')}</span>
                  )}
                {versions.length > 1 && (
                  <div className='glossa-chat-versions'>
                    <button
                      type='button'
                      className='glossa-chat-text-button'
                      aria-label={_('Previous answer')}
                      title={_('Previous answer')}
                      disabled={busy || activeIndex <= 0}
                      onClick={() => switchVersion(index, versions[activeIndex - 1]!.id)}
                    >
                      <ChevronLeft size={14} />
                    </button>
                    <span className='glossa-chat-version-count'>
                      {activeIndex + 1}/{versions.length}
                    </span>
                    <button
                      type='button'
                      className='glossa-chat-text-button'
                      aria-label={_('Next answer')}
                      title={_('Next answer')}
                      disabled={busy || activeIndex >= versions.length - 1}
                      onClick={() => switchVersion(index, versions[activeIndex + 1]!.id)}
                    >
                      <ChevronRight size={14} />
                    </button>
                  </div>
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
                {index === turns.length - 1 && !editing && (
                  <button
                    type='button'
                    className='glossa-chat-text-button'
                    aria-label={_('Edit question')}
                    title={_('Edit question')}
                    disabled={busy}
                    onClick={() => startEditing(turn)}
                  >
                    <Pencil size={14} />
                  </button>
                )}
                {index === turns.length - 1 && (
                  <button
                    type='button'
                    className='glossa-chat-text-button'
                    aria-label={_('Regenerate reply')}
                    title={_('Regenerate reply')}
                    disabled={busy || !ready}
                    onClick={() => void send({ versionOf: index })}
                  >
                    <RefreshCw size={14} />
                  </button>
                )}
              </div>
            </article>
          );
        })}
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
              onClick={() => void send({ question: failedQuestion })}
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
            maxLength={MAX_QUESTION_CHARS}
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
            <ConversationPromptPicker openSettings={openPrompts} />
            <div className='glossa-chat-composer-actions'>
              {capabilities && capabilities.reasoningEfforts.length > 0 && (
                <select
                  className='glossa-chat-effort'
                  aria-label={_('Reasoning effort')}
                  title={_('Reasoning effort')}
                  value={
                    capabilities.reasoningEfforts.includes(
                      config?.reasoningEffort as ReasoningEffort,
                    )
                      ? (config?.reasoningEffort as string)
                      : ''
                  }
                  onChange={(event) => void updateEffort(event.target.value)}
                >
                  <option value=''>{_('Service default')}</option>
                  {capabilities.reasoningEfforts.map((effort) => (
                    <option key={effort} value={effort}>
                      {effortLabels[effort]}
                    </option>
                  ))}
                </select>
              )}
              {draft.length > 0 && (
                <span className='glossa-chat-count' aria-hidden='true'>
                  {`${draft.length}/${MAX_QUESTION_CHARS}`}
                </span>
              )}
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
          </div>
        </form>
      </div>
    </section>
  );
}
