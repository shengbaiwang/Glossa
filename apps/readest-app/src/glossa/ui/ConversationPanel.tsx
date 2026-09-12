import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  Copy,
  Plus,
  Undo2,
  X,
  MessageCircle,
  ArrowUp,
  Square,
} from '@/components/GlossaIcons';
import { useTranslation } from '@/hooks/useTranslation';
import { useReaderStore } from '@/store/readerStore';
import { useBookProgress } from '@/store/readerProgressStore';
import { useSettingsStore } from '@/store/settingsStore';
import type { Book } from '@/types/book';
import type { BookDoc } from '@/libs/document';
import type { ChapterSource } from '@/glossa/context/types';
import { listChapters } from '@/glossa/context/chapters';
import { createConversationReader, mergeConversationSources } from '@/glossa/context/conversation';
import {
  readScopeEvidence,
  selectScopeEvidence,
  SCOPE_LABELS,
  type ConversationScope,
} from '@/glossa/context/conversationScope';
import { resolveSource } from '@/glossa/citations/sources';
import { navigateGuideSource } from '@/glossa/citations/navigation';
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
  type ConversationBlock,
  type ConversationTurn,
} from '@/glossa/conversation/schema';
import {
  CONTEXT_BUDGETS,
  fitConversationEvidence,
  type ContextBudget,
  type ContextReceipt,
  type ReadingIdentity,
} from '@/glossa/conversation/context';
import { generateConversation, summarizeConversation } from '@/glossa/conversation/generate';
import {
  appendConversationTurn,
  hasUnsavedConversations,
  loadConversations,
  saveConversations,
  type ConversationHistory,
} from '@/glossa/conversation/store';
import { useConversationSelection } from '@/glossa/conversation/selection';
import { writeTextToClipboard } from '@/utils/clipboard';

interface Props {
  book: Book;
  bookDoc: BookDoc;
  bookKey: string;
}
const drafts = new Map<string, string>();
const errorMessage = (cause: unknown, fallback: string) =>
  cause instanceof ConversationError || cause instanceof ModelServiceError
    ? cause.message
    : fallback;
const labels: Record<ConversationBlock['kind'], string> = {
  source: 'From the text',
  inference: 'Interpretation',
  background: 'Background knowledge',
  insufficient: 'Insufficient evidence',
};
const newSession = () => ({ id: crypto.randomUUID(), turns: [] as ConversationTurn[] });

export default function ConversationPanel(props: Props) {
  return <ConversationBook key={`${props.book.hash}:${props.bookKey}`} {...props} />;
}
function ConversationBook({ book, bookDoc, bookKey }: Props) {
  const _ = useTranslation();
  const progress = useBookProgress(bookKey);
  const reader = useMemo(
    () => createConversationReader(bookDoc, () => useReaderStore.getState().getView(bookKey)),
    [bookDoc, bookKey],
  );
  const chapters = useMemo(() => listChapters(bookDoc), [bookDoc]);
  const attached = useConversationSelection((s) => s.selection);
  const [selectionCfi, setSelectionCfi] = useState('');
  const [scope, setScope] = useState<ConversationScope>('page');
  const [entryId, setEntryId] = useState('');
  const [extraEntryIds, setExtraEntryIds] = useState<string[]>([]);
  const [paragraphIndex, setParagraphIndex] = useState(0);
  const [paragraphs, setParagraphs] = useState<ChapterSource[]>([]);
  const [selectionSources, setSelectionSources] = useState<ChapterSource[]>([]);
  const [candidates, setCandidates] = useState<ChapterSource[]>([]);
  const [budget, setBudget] = useState<ContextBudget>(2000);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [includeHistory, setIncludeHistory] = useState(true);
  const [pinned, setPinned] = useState<{
    sources: ChapterSource[];
    sampled: boolean;
    title: string;
    selectedSourceIds?: string[];
  } | null>(null);
  const [sampled, setSampled] = useState(false);
  const [contextBusy, setContextBusy] = useState(true);
  const [contextError, setContextError] = useState('');
  const [preparedKey, setPreparedKey] = useState('');
  const [contextRevision, setContextRevision] = useState(0);
  const [draft, setDraft] = useState(() => drafts.get(book.hash) ?? '');
  const [history, setHistory] = useState<ConversationHistory | null>(null);
  const [historyError, setHistoryError] = useState('');
  const [loadRevision, setLoadRevision] = useState(0);
  const [saveError, setSaveError] = useState(false);
  const [config, setConfig] = useState<ProviderConfig | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pendingQuestion, setPendingQuestion] = useState('');
  const [streamed, setStreamed] = useState<ConversationBlock[]>([]);
  const [requestSources, setRequestSources] = useState<ChapterSource[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [sourcePreview, setSourcePreview] = useState<ChapterSource | null>(null);
  const [verified, setVerified] = useState('');
  const [returnLocation, setReturnLocation] = useState('');
  const [navigationBusy, setNavigationBusy] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const request = useRef<AbortController | null>(null);
  const contextRequest = useRef<AbortController | null>(null);
  const navigation = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const transcript = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const visibleLocation = reader.visibleLocation() ?? progress?.location ?? '';
  const largeScope = ['section', 'article', 'chapter', 'book'].includes(scope);
  const contextQuery = largeScope && !pinned ? draft : '';
  const captureLocation = pinned ? '' : visibleLocation;
  const sources = useMemo(() => {
    const available = candidates.filter((source) => !excluded.includes(source.sourceId));
    const selectionIds = new Set(selectionSources.map((source) => source.sourceId));
    const selected = fitConversationEvidence(
      available.filter((source) => selectionIds.has(source.sourceId)),
      budget,
    );
    const rest = available.filter((source) => !selectionIds.has(source.sourceId));
    const remaining = budget - selected.reduce((n, source) => n + source.text.length, 0);
    return [
      ...selected,
      ...(largeScope && !pinned
        ? selectScopeEvidence(rest, contextQuery, false, remaining)
        : fitConversationEvidence(rest, remaining)),
    ];
  }, [candidates, budget, excluded, selectionSources, largeScope, pinned, contextQuery]);
  const metadata: ReadingIdentity = {
    bookTitle: (book.title ?? '').slice(0, 500),
    author: (book.author ?? '').slice(0, 500),
    chapterTitle: (progress?.sectionLabel ?? '').slice(0, 500),
    progress:
      typeof progress?.fraction === 'number' && Number.isFinite(progress.fraction)
        ? Math.min(1, Math.max(0, progress.fraction))
        : null,
  };
  const contextKey = JSON.stringify([
    scope,
    entryId,
    extraEntryIds,
    paragraphIndex,
    selectionCfi,
    captureLocation,
    pinned?.sources.map((source) => source.sourceId),
    contextQuery,
    contextRevision,
  ]);
  const turns = history?.sessions.find((s) => s.id === history.activeId)?.turns ?? [];
  const memory = config && includeHistory ? summarizeConversation(turns, sources, config) : [];
  const partialEvidence = sampled || sources.length < candidates.length;
  const scopeTitle =
    pinned?.title ??
    chapters
      .filter((c) => c.id === entryId || extraEntryIds.includes(c.id))
      .map((c) => c.title)
      .join(' · ');
  const clearFocus = () => {
    setPinned(null);
    setExcluded([]);
  };
  const sourceTitle = (source: ChapterSource) => {
    const entries = chapters.filter((c) => c.sectionIndex === source.anchor.sectionIndex);
    return entries.length === 1
      ? entries[0]!.title
      : _('Reading section {{number}}', { number: source.anchor.sectionIndex + 1 });
  };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current?.abort();
      contextRequest.current?.abort();
      navigation.current?.abort();
    };
  }, []);
  useEffect(() => {
    drafts.set(book.hash, draft);
  }, [book.hash, draft]);
  useEffect(() => {
    if (attached?.bookKey === bookKey) {
      request.current?.abort();
      setSelectionCfi(attached.cfi);
      setPinned(null);
      setExcluded([]);
      composer.current?.focus();
    }
  }, [attached, bookKey]);
  useEffect(() => {
    let active = true;
    setHistoryError('');
    void loadConversations(book.hash)
      .then((saved) => {
        if (!active) return;
        const session = newSession();
        setHistory(
          saved ?? { version: 1, bookId: book.hash, sessions: [session], activeId: session.id },
        );
        const last = saved?.sessions.find((s) => s.id === saved.activeId)?.turns.at(-1);
        if (last?.sources.length) {
          setPinned({
            sources: last.sources,
            sampled: last.context?.sampled ?? true,
            title: last.context?.title ?? '',
            selectedSourceIds: last.context?.selectedSourceIds,
          });
          if (last.context) {
            setBudget(last.context.budget);
            if (last.context.scope in SCOPE_LABELS)
              setScope(last.context.scope as ConversationScope);
            setIncludeHistory(last.context.includeHistory ?? true);
          }
        }
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
      request.current?.abort();
      const next = getActiveProviderConfig();
      setConfig(next);
      setReady(false);
      if (!next) return;
      try {
        const status = await getProviderStatus(next);
        if (active && ticket === sequence) setReady(status.configured);
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
    const controller = new AbortController();
    contextRequest.current = controller;
    setContextBusy(true);
    setContextError('');
    setCandidates([]);
    setSelectionSources([]);
    setSampled(false);
    const prepare = async () => {
      if (pinned) {
        setCandidates(pinned.sources);
        setSelectionSources(
          pinned.sources.filter((source) => pinned.selectedSourceIds?.includes(source.sourceId)),
        );
        setSampled(pinned.sampled);
        setPreparedKey(contextKey);
        return;
      }
      const selection = selectionCfi
        ? await reader.readLocation(selectionCfi, controller.signal)
        : [];
      let context: ChapterSource[] = [];
      let partial = false;
      if (scope === 'page' || scope === 'paragraph') {
        if (!captureLocation)
          throw new ConversationError(
            'The reading context could not be captured. Select text or try again.',
          );
        const page = await reader.readLocation(
          captureLocation,
          controller.signal,
          scope === 'paragraph',
        );
        if (!controller.signal.aborted) setParagraphs(page);
        context =
          scope === 'paragraph'
            ? page.slice(
                Math.min(paragraphIndex, Math.max(0, page.length - 1)),
                Math.min(paragraphIndex, Math.max(0, page.length - 1)) + 1,
              )
            : page;
      } else if (largeScope) {
        const selectedChapters = chapters.filter(
          (c) => c.id === entryId || extraEntryIds.includes(c.id),
        );
        if (scope !== 'book' && !selectedChapters.length)
          throw new ConversationError('Choose an entry from this book’s contents.');
        const targets = scope === 'book' ? [undefined] : selectedChapters;
        const collected: ChapterSource[] = [];
        for (const chapter of targets) {
          const result = await readScopeEvidence(bookDoc, chapter, contextQuery, controller.signal);
          collected.push(...result.sources);
          partial ||= result.sampled;
        }
        const unique = [...new Map(collected.map((source) => [source.sourceId, source])).values()];
        context = selectScopeEvidence(
          unique,
          contextQuery,
          false,
          8000 - selection.reduce((n, source) => n + source.text.length, 0),
        );
        partial ||= context.length < unique.length;
      }
      if (scope === 'selection' && !selection.length)
        throw new ConversationError('Select text in the book to attach it here.');
      if ((scope === 'page' || scope === 'paragraph') && !context.length)
        throw new ConversationError('No readable text is visible. Select text or turn the page.');
      const combined = mergeConversationSources(selection, context);
      if (!controller.signal.aborted) {
        setSelectionSources(selection);
        setCandidates(combined);
        setSampled(partial);
        setPreparedKey(contextKey);
      }
    };
    const timer = window.setTimeout(
      () => {
        void prepare()
          .catch((cause: unknown) => {
            if (!controller.signal.aborted)
              setContextError(
                errorMessage(cause, 'The reading context could not be prepared. Try again.'),
              );
          })
          .finally(() => {
            if (!controller.signal.aborted) setContextBusy(false);
          });
      },
      largeScope && !pinned ? 450 : 0,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [
    reader,
    bookDoc,
    chapters,
    scope,
    entryId,
    extraEntryIds,
    paragraphIndex,
    selectionCfi,
    captureLocation,
    pinned,
    contextQuery,
    contextRevision,
    largeScope,
    contextKey,
  ]);
  useEffect(() => {
    if (atBottom && transcript.current)
      transcript.current.scrollTop = transcript.current.scrollHeight;
  }, [turns.length, streamed.length, busy, atBottom]);

  const openModels = () => {
    const settings = useSettingsStore.getState();
    settings.setSettingsDialogBookKey(bookKey);
    settings.setRequestedPanel('Models');
    settings.setSettingsDialogOpen(true);
  };
  const persist = (next: ConversationHistory) => {
    setHistory(next);
    setSaveError(false);
    void saveConversations(next)
      .then(() => {
        if (mounted.current) setSaveError(hasUnsavedConversations(book.hash));
      })
      .catch(() => {
        if (mounted.current) setSaveError(true);
      });
  };
  const send = async () => {
    if (
      request.current ||
      !history ||
      !config ||
      !ready ||
      contextBusy ||
      contextError ||
      preparedKey !== contextKey ||
      !draft.trim() ||
      turns.length >= 40
    )
      return;
    const controller = new AbortController();
    request.current = controller;
    const question = draft.trim();
    const snapshot = structuredClone(sources);
    const receipt: ContextReceipt = structuredClone({
      metadata,
      budget,
      scope,
      title: scopeTitle.slice(0, 500),
      sampled: partialEvidence,
      history: memory,
      includeHistory,
      selectedSourceIds: selectionSources
        .filter((s) => snapshot.some((v) => v.sourceId === s.sourceId))
        .map((s) => s.sourceId),
      sourceTitles: Object.fromEntries(
        snapshot.map((source) => [source.sourceId, sourceTitle(source).slice(0, 500)]),
      ),
    });
    setBusy(true);
    setError('');
    setNotice('');
    setPendingQuestion(question);
    setStreamed([]);
    setRequestSources(snapshot);
    setAtBottom(true);
    try {
      const blocks = await generateConversation({
        bookId: book.hash,
        bookTitle: book.title,
        metadata: receipt.metadata,
        sourceTitles: receipt.sourceTitles,
        budget,
        includeHistory,
        question,
        sources: snapshot,
        turns,
        config,
        signal: controller.signal,
        scope: {
          name: scope,
          title: receipt.title,
          sampled: receipt.sampled,
          selectedSourceIds: receipt.selectedSourceIds ?? [],
        },
        onBlocks: (blocks) => {
          if (!controller.signal.aborted && mounted.current) setStreamed(blocks);
        },
      });
      if (controller.signal.aborted || !mounted.current) return;
      persist(
        appendConversationTurn(history, {
          id: crypto.randomUUID(),
          question,
          blocks,
          sources: snapshot,
          createdAt: Date.now(),
          provider: config,
          promptVersion: CONVERSATION_PROMPT_VERSION,
          context: receipt,
        }),
      );
      if (snapshot.length)
        setPinned({
          sources: snapshot,
          sampled: receipt.sampled,
          title: receipt.title,
          selectedSourceIds: receipt.selectedSourceIds,
        });
      setDraft('');
    } catch (cause) {
      if (mounted.current) {
        if (controller.signal.aborted)
          setNotice('Reply stopped. Your question is ready to send again.');
        else setError(errorMessage(cause, 'The reply could not be completed. Try again.'));
      }
    } finally {
      if (request.current === controller) request.current = null;
      if (mounted.current) {
        setBusy(false);
        setPendingQuestion('');
        setStreamed([]);
      }
    }
  };
  const changeSession = (id?: string) => {
    if (!history || busy) return;
    if (id) persist({ ...history, activeId: id });
    else if (!turns.length) return;
    else if (history.sessions.length >= 20) {
      setError('This book has 20 conversations. Delete a conversation before starting another.');
      return;
    } else {
      const session = newSession();
      persist({ ...history, sessions: [...history.sessions, session], activeId: session.id });
    }
    const last = id ? history.sessions.find((s) => s.id === id)?.turns.at(-1) : undefined;
    setPinned(
      last?.sources.length
        ? {
            sources: last.sources,
            sampled: last.context?.sampled ?? true,
            title: last.context?.title ?? '',
            selectedSourceIds: last.context?.selectedSourceIds,
          }
        : null,
    );
    setExcluded([]);
    setIncludeHistory(true);
    setSelectionCfi('');
    useConversationSelection.setState({ selection: null });
    if (!last) {
      setBudget(2000);
      setScope('page');
      setEntryId('');
      setExtraEntryIds([]);
    }
    if (last?.context) {
      setBudget(last.context.budget);
      setIncludeHistory(last.context.includeHistory ?? true);
      if (last.context.scope in SCOPE_LABELS) setScope(last.context.scope as ConversationScope);
    }
    setDraft('');
    setError('');
    setNotice('');
    setSourcePreview(null);
    setReturnLocation('');
    navigation.current?.abort();
  };
  const verify = async (source: ChapterSource, jump: boolean) => {
    navigation.current?.abort();
    const controller = new AbortController();
    navigation.current = controller;
    setSourcePreview(source);
    setVerified('');
    setNavigationBusy(true);
    setError('');
    try {
      const resolved = await resolveSource(bookDoc, source, { signal: controller.signal });
      if (!resolved)
        throw new ConversationError('This source could not be verified in the local book.');
      if (controller.signal.aborted) return;
      setVerified(resolved.text);
      if (jump) {
        const view = useReaderStore.getState().getView(bookKey);
        if (!view) throw new Error();
        const origin = view.lastLocation?.cfi;
        if (!returnLocation && origin) setReturnLocation(origin);
        await navigateGuideSource(view, resolved.cfi, controller.signal);
      }
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(errorMessage(cause, 'The source could not be opened. Try again.'));
    } finally {
      if (!controller.signal.aborted) setNavigationBusy(false);
    }
  };
  const goBack = async () => {
    navigation.current?.abort();
    const controller = new AbortController();
    navigation.current = controller;
    setNavigationBusy(true);
    try {
      const view = useReaderStore.getState().getView(bookKey);
      if (!view) throw new Error();
      await navigateGuideSource(view, returnLocation, controller.signal);
      if (!controller.signal.aborted) {
        setReturnLocation('');
        setSourcePreview(null);
      }
    } catch {
      if (!controller.signal.aborted)
        setError('The reading position could not be restored. Try again.');
    } finally {
      if (!controller.signal.aborted) setNavigationBusy(false);
    }
  };
  const renderBlocks = (blocks: ConversationBlock[], evidence: ChapterSource[]) =>
    blocks.map((block, index) => (
      <div className='glossa-chat-answer-block' key={index}>
        <span className='glossa-chat-kind'>{_(labels[block.kind])}</span>
        <p dir='auto'>{block.text}</p>
        {!!block.sourceIds.length && (
          <div className='glossa-chat-citations'>
            {block.kind === 'background' && <span>{_('Related text')}</span>}
            {block.sourceIds.map((id) => {
              const source = evidence.find((s) => s.sourceId === id);
              return source ? (
                <button
                  type='button'
                  key={id}
                  onClick={() => void verify(source, false)}
                  aria-label={_('Check source {{number}}', {
                    number: evidence.indexOf(source) + 1,
                  })}
                >
                  [{evidence.indexOf(source) + 1}]
                </button>
              ) : null;
            })}
          </div>
        )}
      </div>
    ));
  const suggestions = selectionCfi
    ? [
        'Explain this selection',
        'What does this term mean here?',
        'How does this support the author’s point?',
      ]
    : [
        'Explain the main idea here',
        'Help me follow the reasoning',
        'What should I pay attention to?',
      ];
  const canSend =
    !!draft.trim() &&
    draft.length <= 2000 &&
    ready &&
    !!history &&
    !busy &&
    !contextBusy &&
    !contextError &&
    preparedKey === contextKey &&
    turns.length < 40;
  return (
    <section
      className='glossa-chat-panel'
      aria-label={_('Conversation')}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') event.stopPropagation();
      }}
    >
      <div className='glossa-chat-toolbar'>
        <span className='glossa-chat-local'>{_('Conversations stay on this device')}</span>
        <button
          type='button'
          className='glossa-chat-text-button'
          disabled={busy || !turns.length}
          onClick={() => changeSession()}
        >
          <Plus size={15} />
          {_('New conversation')}
        </button>
      </div>
      {history && history.sessions.length > 1 && (
        <div className='glossa-chat-history'>
          <select
            className='eink-bordered'
            aria-label={_('Conversation history')}
            value={history.activeId}
            disabled={busy}
            onChange={(e) => changeSession(e.target.value)}
          >
            {[...history.sessions].reverse().map((s) => (
              <option key={s.id} value={s.id}>
                {s.turns[0]?.question.slice(0, 48) || _('New conversation')}
              </option>
            ))}
          </select>
          <button
            type='button'
            className='glossa-chat-text-button'
            disabled={busy}
            onClick={() => {
              if (!window.confirm(_('Delete this conversation from this device?'))) return;
              const sessions = history.sessions.filter((s) => s.id !== history.activeId);
              if (!sessions.length) sessions.push(newSession());
              persist({ ...history, sessions, activeId: sessions.at(-1)!.id });
              clearFocus();
              setDraft('');
              setSelectionCfi('');
              useConversationSelection.setState({ selection: null });
            }}
          >
            {_('Delete')}
          </button>
        </div>
      )}
      {historyError && (
        <div className='glossa-chat-message' role='alert'>
          {_(historyError)}{' '}
          <button type='button' onClick={() => setLoadRevision((n) => n + 1)}>
            {_('Retry')}
          </button>
        </div>
      )}
      {saveError && (
        <div className='glossa-chat-message' role='alert'>
          {_('Not saved yet. This conversation is still available here.')}{' '}
          <button type='button' onClick={() => history && persist(history)}>
            {_('Retry saving')}
          </button>
        </div>
      )}
      <div
        className='glossa-chat-transcript'
        ref={transcript}
        role='log'
        aria-label={_('Conversation messages')}
        aria-live={busy ? 'off' : 'polite'}
        onScroll={(e) => {
          const el = e.currentTarget;
          setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
        }}
      >
        {!turns.length && !busy && (
          <div className='glossa-chat-welcome'>
            <MessageCircle size={29} />
            <h3>{_('Read, ask, understand.')}</h3>
            <p>{_('Ask about the words in front of you. Keep the original close by.')}</p>
            <div className='glossa-chat-suggestions'>
              {suggestions.map((q) => (
                <button
                  className='eink-bordered'
                  type='button'
                  key={q}
                  onClick={() => {
                    setDraft(_(q));
                    composer.current?.focus();
                  }}
                >
                  {_(q)}
                </button>
              ))}
            </div>
          </div>
        )}
        {turns.map((turn) => (
          <article className='glossa-chat-turn' key={turn.id}>
            <div className='glossa-chat-question eink-bordered' dir='auto'>
              {turn.question}
            </div>
            <div className='glossa-chat-answer'>{renderBlocks(turn.blocks, turn.sources)}</div>
            <details className='glossa-chat-evidence glossa-chat-receipt'>
              <summary>{_('Materials used for this reply')}</summary>
              <div>
                {turn.context && (
                  <p dir='auto'>
                    {turn.context.metadata.bookTitle} ·{' '}
                    {turn.context.metadata.author || _('Unknown author')}
                    <br />
                    {turn.context.metadata.chapterTitle || _('Chapter unavailable')} ·{' '}
                    {turn.context.metadata.progress === null
                      ? _('Progress unavailable')
                      : `${Math.round(turn.context.metadata.progress * 100)}%`}
                    <br />
                    {_(SCOPE_LABELS[turn.context.scope as ConversationScope] ?? 'Context')} ·{' '}
                    {turn.context.title} ·{' '}
                    {turn.context.sampled ? _('Partial evidence') : _('Selected materials')}
                  </p>
                )}
                {!turn.sources.length && <p>{_('No book text was sent.')}</p>}
                {turn.sources.map((source, index) => (
                  <div key={source.sourceId}>
                    <p dir='auto'>
                      <b>
                        [{index + 1}]{' '}
                        {turn.context?.sourceTitles?.[source.sourceId] ?? sourceTitle(source)}
                      </b>
                      <br />
                      {source.text}
                    </p>
                    <button
                      type='button'
                      className='glossa-chat-text-button'
                      onClick={() => void verify(source, true)}
                    >
                      {_('Go to original text')}
                    </button>
                  </div>
                ))}
                {turn.context?.history.map((item, index) => (
                  <p key={index} dir='auto'>
                    {item.question}
                    <br />
                    {item.summary}
                  </p>
                ))}
                <button
                  type='button'
                  className='glossa-chat-text-button'
                  disabled={busy}
                  onClick={() => {
                    setPinned({
                      sources: turn.sources,
                      sampled: turn.context?.sampled ?? true,
                      title: turn.context?.title ?? '',
                      selectedSourceIds: turn.context?.selectedSourceIds,
                    });
                    setExcluded([]);
                    if (turn.context) {
                      setBudget(turn.context.budget);
                      if (turn.context.scope in SCOPE_LABELS)
                        setScope(turn.context.scope as ConversationScope);
                    }
                    setSelectionCfi('');
                    useConversationSelection.setState({ selection: null });
                  }}
                >
                  {_('Use these materials')}
                </button>
              </div>
            </details>
            <div className='glossa-chat-answer-actions'>
              <span>{turn.provider.model}</span>
              <button
                type='button'
                className='glossa-chat-text-button'
                aria-label={_('Copy reply')}
                onClick={() => {
                  void writeTextToClipboard(
                    turn.blocks.map((b) => `${_(labels[b.kind])}\n${b.text}`).join('\n\n'),
                  )
                    .then(() => setNotice('Copied to clipboard'))
                    .catch(() => setError('The reply could not be copied.'));
                }}
              >
                <Copy size={14} />
              </button>
              <button
                type='button'
                className='glossa-chat-text-button'
                disabled={busy}
                onClick={() => {
                  setDraft(turn.question);
                  composer.current?.focus();
                }}
              >
                {_('Ask again')}
              </button>
            </div>
          </article>
        ))}
        {busy && (
          <article className='glossa-chat-turn'>
            <div className='glossa-chat-question eink-bordered' dir='auto'>
              {pendingQuestion}
            </div>
            <div className='glossa-chat-answer'>{renderBlocks(streamed, requestSources)}</div>
            <p className='glossa-chat-pending' role='status'>
              {_(streamed.length ? 'Replying…' : 'Thinking about this passage…')}
            </p>
          </article>
        )}
      </div>
      {!atBottom && (
        <button type='button' className='glossa-chat-latest' onClick={() => setAtBottom(true)}>
          {_('Latest reply')}
        </button>
      )}
      {returnLocation && (
        <button
          type='button'
          className='glossa-chat-return'
          disabled={navigationBusy}
          onClick={() => void goBack()}
        >
          <Undo2 size={15} />
          {_('Back to reading position')}
        </button>
      )}
      {sourcePreview && (
        <aside className='glossa-chat-source eink-bordered' aria-label={_('Original source')}>
          <div>
            <strong>{_('Original source')}</strong>
            <button
              type='button'
              aria-label={_('Close source')}
              onClick={() => {
                navigation.current?.abort();
                setNavigationBusy(false);
                setSourcePreview(null);
              }}
            >
              <X size={15} />
            </button>
          </div>
          <blockquote dir='auto'>
            {verified ||
              (navigationBusy
                ? _('Checking local source…')
                : _('This source could not be verified in the local book.'))}
          </blockquote>
          <button
            type='button'
            className='glossa-chat-text-button'
            disabled={navigationBusy || !verified}
            onClick={() => void verify(sourcePreview, true)}
          >
            {_('Go to original text')}
          </button>
        </aside>
      )}
      {(error || notice) && (
        <p className='glossa-chat-message' role={error ? 'alert' : 'status'}>
          {_(error || notice)}
        </p>
      )}
      <div className='glossa-chat-composer-wrap'>
        <div className='glossa-chat-context eink-bordered'>
          <div className='glossa-chat-sharing'>
            <BookOpen size={15} />
            <span title={metadata.bookTitle}>{metadata.bookTitle}</span>
            <span className='glossa-chat-always'>{_('Always included')}</span>
          </div>
          <p className='glossa-chat-identity' dir='auto'>
            {metadata.author || _('Unknown author')}
            <br />
            {metadata.chapterTitle || _('Chapter unavailable')} ·{' '}
            {metadata.progress === null
              ? _('Progress unavailable')
              : `${Math.round(metadata.progress * 100)}%`}
          </p>
          {pinned && (
            <div className='glossa-chat-focus eink-bordered'>
              <span>{_('Materials kept for follow-up')}</span>
              <button
                type='button'
                disabled={busy}
                onClick={() => {
                  clearFocus();
                  setScope('page');
                  setEntryId('');
                  setExtraEntryIds([]);
                  setSelectionCfi('');
                  useConversationSelection.setState({ selection: null });
                }}
              >
                {_('Use current reading materials')}
              </button>
            </div>
          )}
          <details className='glossa-chat-evidence glossa-chat-controls'>
            <summary>
              {_('Adjust materials')} · {_(pinned ? 'Follow-up materials' : SCOPE_LABELS[scope])} ·{' '}
              {budget.toLocaleString()}
            </summary>
            <div>
              <div className='glossa-chat-scope'>
                <label htmlFor={`${bookKey}-chat-scope`}>{_('Context')}</label>
                <select
                  id={`${bookKey}-chat-scope`}
                  value={scope}
                  disabled={busy}
                  onChange={(e) => {
                    clearFocus();
                    setScope(e.target.value as ConversationScope);
                    setEntryId('');
                    setExtraEntryIds([]);
                    setContextError('');
                  }}
                >
                  {Object.entries(SCOPE_LABELS).map(([id, label]) => (
                    <option key={id} value={id}>
                      {_(label)}
                    </option>
                  ))}
                </select>
              </div>
              <div className='glossa-chat-scope'>
                <label htmlFor={`${bookKey}-chat-budget`}>{_('Text budget')}</label>
                <select
                  id={`${bookKey}-chat-budget`}
                  value={budget}
                  disabled={busy}
                  onChange={(e) => setBudget(Number(e.target.value) as ContextBudget)}
                >
                  {CONTEXT_BUDGETS.map((value, index) => (
                    <option key={value} value={value}>
                      {_(
                        [
                          'Light · 2,000 characters',
                          'Balanced · 4,000 characters',
                          'Extended · 8,000 characters',
                        ][index]!,
                      )}
                    </option>
                  ))}
                </select>
              </div>
              {scope !== 'none' && (
                <button
                  className='glossa-chat-text-button'
                  type='button'
                  disabled={busy}
                  aria-label={_('Stop sharing reading context')}
                  onClick={() => {
                    clearFocus();
                    setScope('none');
                    setSelectionCfi('');
                    useConversationSelection.setState({ selection: null });
                  }}
                >
                  {_('Use book information only')}
                </button>
              )}
              {['section', 'article', 'chapter'].includes(scope) && (
                <select
                  className='glossa-chat-outline'
                  aria-label={_('Choose from contents')}
                  value={entryId}
                  disabled={busy}
                  onChange={(e) => {
                    clearFocus();
                    setEntryId(e.target.value);
                  }}
                >
                  <option value=''>{_('Choose from contents')}</option>
                  {chapters.map((c) => (
                    <option key={c.id} value={c.id}>
                      {'　'.repeat(c.depth)}
                      {c.title}
                    </option>
                  ))}
                </select>
              )}
              {['section', 'article', 'chapter'].includes(scope) && (
                <div className='glossa-chat-extra-chapters'>
                  {extraEntryIds.map((id) => (
                    <div className='glossa-chat-focus eink-bordered' key={id}>
                      <span dir='auto'>{chapters.find((chapter) => chapter.id === id)?.title}</span>
                      <button
                        type='button'
                        disabled={busy}
                        aria-label={_('Remove chapter {{title}}', {
                          title: chapters.find((chapter) => chapter.id === id)?.title ?? '',
                        })}
                        onClick={() => {
                          clearFocus();
                          setExtraEntryIds((ids) => ids.filter((value) => value !== id));
                        }}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                  <button
                    className='glossa-chat-text-button'
                    type='button'
                    disabled={
                      busy ||
                      !entryId ||
                      extraEntryIds.includes(entryId) ||
                      extraEntryIds.length >= 3
                    }
                    onClick={() => {
                      clearFocus();
                      setExtraEntryIds((ids) => [...ids, entryId]);
                      setEntryId('');
                    }}
                  >
                    {_('Add another chapter')}
                  </button>
                </div>
              )}
              {scope === 'paragraph' && !!paragraphs.length && (
                <select
                  className='glossa-chat-outline'
                  aria-label={_('Choose a paragraph')}
                  disabled={busy}
                  value={paragraphIndex}
                  onChange={(e) => {
                    clearFocus();
                    setParagraphIndex(Number(e.target.value));
                  }}
                >
                  {paragraphs.map((p, i) => (
                    <option key={p.sourceId} value={i}>
                      {i + 1}. {p.text.slice(0, 56)}
                    </option>
                  ))}
                </select>
              )}
              {largeScope && (
                <p className='glossa-chat-scope-note'>
                  {_('This range may include unread text. Only relevant excerpts are sent.')}
                </p>
              )}
              <p className='glossa-chat-scope-note'>
                {_(
                  'Book information, instructions, your question and up to four short summaries are additional input. Reply limit: 16,384 tokens. Actual billing depends on your model service.',
                )}
              </p>
            </div>
          </details>
          {selectionCfi && (
            <div className='glossa-chat-selection eink-bordered'>
              <div>
                <span>{_('Selected text')}</span>
                <button
                  type='button'
                  disabled={busy}
                  aria-label={_('Remove selected text')}
                  onClick={() => {
                    clearFocus();
                    setSelectionCfi('');
                    useConversationSelection.setState({ selection: null });
                  }}
                >
                  <X size={14} />
                </button>
              </div>
              <p dir='auto'>
                {selectionSources.map((s) => s.text).join(' ') || _('Preparing selection…')}
              </p>
            </div>
          )}
          {contextBusy ? (
            <div className='glossa-chat-context-status' role='status'>
              {_('Preparing reading context…')}
              <button
                type='button'
                onClick={() => {
                  contextRequest.current?.abort();
                  setContextBusy(false);
                  setContextError('Context preparation stopped. Retry when ready.');
                }}
              >
                {_('Stop')}
              </button>
            </div>
          ) : contextError ? (
            <div className='glossa-chat-context-status' role='alert'>
              {_(contextError)}
              <button type='button' onClick={() => setContextRevision((n) => n + 1)}>
                {_('Retry')}
              </button>
            </div>
          ) : (
            <details className='glossa-chat-evidence'>
              <summary>
                {_('{{count}} excerpts · {{characters}} / {{limit}} characters', {
                  count: sources.length,
                  limit: budget,
                  characters: sources.reduce((n, s) => n + s.text.length, 0),
                })}
                {partialEvidence ? ` · ${_('Partial evidence')}` : ''}
              </summary>
              <div>
                {candidates.length ? (
                  candidates.map((s, i) => (
                    <div className='glossa-chat-material' key={s.sourceId}>
                      <label>
                        <input
                          type='checkbox'
                          disabled={busy}
                          checked={!excluded.includes(s.sourceId)}
                          aria-label={_('Include excerpt {{number}}', { number: i + 1 })}
                          onChange={(e) =>
                            setExcluded((previous) =>
                              e.target.checked
                                ? previous.filter((id) => id !== s.sourceId)
                                : [...previous, s.sourceId],
                            )
                          }
                        />
                        <span dir='auto'>{sourceTitle(s)}</span>
                        <span>
                          {sources.includes(s)
                            ? _('Included')
                            : excluded.includes(s.sourceId)
                              ? _('Excluded')
                              : _('Over budget')}
                        </span>
                      </label>
                      <small>
                        {_(
                          pinned
                            ? 'Retained for follow-up'
                            : selectionSources.some((source) => source.sourceId === s.sourceId)
                              ? 'Selected text'
                              : largeScope
                                ? 'Retrieved from the selected range'
                                : 'From the selected reading range',
                        )}
                      </small>
                      <p dir='auto'>{s.text}</p>
                      <button
                        className='glossa-chat-text-button'
                        type='button'
                        onClick={() => void verify(s, true)}
                      >
                        {_('Go to original text')}
                      </button>
                    </div>
                  ))
                ) : (
                  <p>
                    {_(
                      'No book text will be sent. Answers will be marked as background or insufficient evidence.',
                    )}
                  </p>
                )}
              </div>
            </details>
          )}
          {candidates.length > sources.length && (
            <p className='glossa-chat-scope-note'>
              {_(
                'Unchecked or over-budget excerpts will not be sent. Increase the budget or adjust materials.',
              )}
            </p>
          )}
          <details className='glossa-chat-evidence'>
            <summary>{_('Follow-up summary · {{count}} turns', { count: memory.length })}</summary>
            <div>
              <label className='glossa-chat-memory-toggle'>
                <input
                  type='checkbox'
                  checked={includeHistory}
                  disabled={busy}
                  onChange={(e) => setIncludeHistory(e.target.checked)}
                />
                {_('Include follow-up summary')}
              </label>
              {memory.map((item, index) => (
                <p key={index} dir='auto'>
                  <b>{item.question}</b>
                  <br />
                  {item.summary}
                </p>
              ))}
              {!memory.length && (
                <p>
                  {_(
                    'No matching summary. Follow-up memory only uses the materials currently included.',
                  )}
                </p>
              )}
            </div>
          </details>
        </div>
        <form
          className='glossa-chat-composer eink-bordered'
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <textarea
            ref={composer}
            aria-label={_('Ask about your reading')}
            placeholder={_(
              selectionCfi ? 'Ask about the selected text…' : 'Ask about your reading…',
            )}
            value={draft}
            maxLength={2000}
            disabled={busy}
            rows={3}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
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
            <button
              type='button'
              className='glossa-chat-model'
              disabled={busy}
              onClick={openModels}
            >
              {config?.model || _('Set up a model')}
              {config?.model && !ready ? ` · ${_('Setup needed')}` : ''}
            </button>
            {busy ? (
              <button
                type='button'
                className='glossa-chat-send btn-contrast'
                aria-label={_('Stop reply')}
                onClick={() => request.current?.abort()}
              >
                <Square size={16} />
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
        <p className='glossa-chat-footnote'>
          {turns.length >= 40
            ? _('Start a new conversation to continue; this one has 40 replies.')
            : _('Enter to send · Shift+Enter for a new line')}
        </p>
      </div>
    </section>
  );
}
