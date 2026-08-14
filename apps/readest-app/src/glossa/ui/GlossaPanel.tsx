import clsx from 'clsx';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FiChevronLeft, FiChevronRight, FiX } from 'react-icons/fi';
import { MdOutlinePushPin, MdPushPin } from 'react-icons/md';

import { Overlay } from '@/components/Overlay';
import { usePanelResize } from '@/hooks/usePanelResize';
import { useSwipeToDismiss } from '@/hooks/useSwipeToDismiss';
import { useTranslation } from '@/hooks/useTranslation';
import { getPanelTopInset } from '@/utils/insets';
import { makeSafeFilename } from '@/utils/misc';
import type { Insets } from '@/types/misc';
import type { AppService } from '@/types/system';
import {
  DeepSeekProvider,
  GlossaRequestController,
  MockProvider,
  clearDeepSeekApiKey,
  getDeepSeekKeychainStatus,
  saveDeepSeekApiKey,
  type AIProvider,
  type AIProviderRequest,
  type AIProviderUsage,
  createGlossaHistorySummary,
  type GlossaAction,
  type ProviderError,
  getAIProviderModelVersion,
  getContextPackId,
  estimateDeepSeekCost,
  type LocalCitation,
  type ValidatedGlossaResult,
} from '../ai';
import type { AnchorNavigationSession } from '../citations/navigation';
import { addReadKeywordCandidates, createReadSectionContextPack } from '../context/contextPack';
import { isGlossaEnabled } from '../featureFlag';
import { extractEpubKeywordQueries } from '../retrieval/epubKeywordSearch';
import {
  getGlossaSourcedNoteOriginal,
  getGlossaSourcedNoteUserNote,
  type GlossaSourcedNote,
} from '../notes/glossaSourcedNotes';
import {
  serializeGlossaSourcedNotesJson,
  serializeGlossaSourcedNotesMarkdown,
} from '../notes/glossaSourcedNotesExport';
import { useGlossaPanelStore } from './glossaPanelStore';

const MIN_GLOSSA_WIDTH = 0.22;
const MAX_GLOSSA_WIDTH = 0.45;
const SELECTION_PREVIEW_LIMIT = 500;
const QUESTION_CHARACTER_LIMIT = 2000;

type ProviderChoice = 'mock' | 'deepseek';
type ContextScopeChoice = 'minimal' | 'chapter-to-selection';
type SourcedNotesExportFormat = 'markdown' | 'json';

type PendingDeepSeekRequest = {
  request: Pick<AIProviderRequest, 'action' | 'question'>;
  label: string;
  contextPack?: AIProviderRequest['contextPack'];
};

type TurnStatus = 'generating' | 'repairing' | 'complete' | 'insufficient' | 'cancelled' | 'error';

type GlossaPanelTurn = {
  id: number;
  question: string;
  status: TurnStatus;
  streamedText: string;
  answer: ValidatedGlossaResult | null;
  errorMessage: string | null;
  errorCode: ProviderError['code'] | null;
  request: Pick<AIProviderRequest, 'action' | 'question'>;
  historySummary: NonNullable<AIProviderRequest['historySummary']> | null;
  contextPackId: string;
  contextPack: AIProviderRequest['contextPack'];
  provider: AIProvider;
  usage?: AIProviderUsage | null;
  completedAt?: Date | null;
};

const canManuallyRetry = (code: ProviderError['code'] | null): boolean =>
  code === 'rate-limited' ||
  code === 'server-error' ||
  code === 'overloaded' ||
  code === 'timeout' ||
  code === 'network-error';

const isChapterSummary = (
  result: ValidatedGlossaResult | null,
): result is Extract<ValidatedGlossaResult, { summary: unknown }> =>
  Boolean(result && 'summary' in result);

const errorGuidance = (
  error: ProviderError,
  translate: (text: string) => string,
): string | null => {
  if (error.code === 'invalid-auth')
    return translate('Delete or reconfigure the DeepSeek API key.');
  if (error.code === 'insufficient-balance')
    return translate('Check the DeepSeek account balance.');
  if (error.code === 'invalid-request')
    return translate('This request cannot be retried automatically.');
  return null;
};

const formatTokenCount = (count: number): string => new Intl.NumberFormat().format(count);

const formatEstimatedUsd = (cost: number): string =>
  new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 8,
  }).format(cost);

const UsageEstimate: React.FC<{
  completedAt?: Date | null;
  provider: AIProvider;
  translate: (text: string) => string;
  usage?: AIProviderUsage | null;
}> = ({ completedAt, provider, translate, usage }) => {
  if (!usage) {
    return (
      <p className='text-base-content/60 text-xs'>
        {translate('Usage and estimated cost unavailable.')}
      </p>
    );
  }
  const estimate = completedAt
    ? estimateDeepSeekCost(getAIProviderModelVersion(provider), usage, completedAt)
    : null;
  return (
    <div aria-label={translate('Usage and estimated cost')} className='space-y-1 text-xs'>
      <p className='text-base-content/60'>
        {translate('Usage')}: {translate('Input')} {formatTokenCount(usage.inputTokens)} ·{' '}
        {translate('Output')} {formatTokenCount(usage.outputTokens)} · {translate('Cache hit')}{' '}
        {formatTokenCount(usage.cacheHitTokens)} · {translate('Cache miss')}{' '}
        {formatTokenCount(usage.cacheMissTokens)}
      </p>
      {estimate ? (
        <p className='text-base-content/60'>
          {translate('Estimated cost')}: {formatEstimatedUsd(estimate.cost)} {estimate.currency} ·{' '}
          {translate('Rate')} {estimate.rateVersion} · {translate(estimate.ratePeriod)} (UTC)
        </p>
      ) : (
        <p className='text-base-content/60'>
          {translate('Estimated cost unavailable: no local rate applies to this model and time.')}
        </p>
      )}
    </div>
  );
};

type GlossaPanelProps = {
  dir?: 'ltr' | 'rtl';
  isEink?: boolean;
  hasRoundedWindow?: boolean;
  safeAreaInsets: Insets | null;
  systemUIVisible: boolean;
  statusBarHeight: number;
  provider?: AIProvider;
  appService?: Pick<AppService, 'saveFile'> | null;
};

const GlossaPanel: React.FC<GlossaPanelProps> = ({
  dir = 'ltr',
  isEink = false,
  hasRoundedWindow = false,
  safeAreaInsets,
  systemUIVisible,
  statusBarHeight,
  provider,
  appService,
}) => {
  // When the feature is off, this component registers no keyboard, overlay,
  // resize, or store behavior. ReaderContent can therefore mount it safely.
  if (!isGlossaEnabled()) return null;

  return (
    <EnabledGlossaPanel
      dir={dir}
      isEink={isEink}
      hasRoundedWindow={hasRoundedWindow}
      safeAreaInsets={safeAreaInsets}
      systemUIVisible={systemUIVisible}
      statusBarHeight={statusBarHeight}
      provider={provider}
      appService={appService}
    />
  );
};

const EnabledGlossaPanel: React.FC<GlossaPanelProps> = ({
  dir = 'ltr',
  isEink = false,
  hasRoundedWindow = false,
  safeAreaInsets,
  systemUIVisible,
  statusBarHeight,
  provider,
  appService,
}) => {
  const _ = useTranslation();
  const {
    isOpen,
    isPinned,
    isCollapsed,
    width,
    selection,
    contextPack,
    chapterContextPack,
    chapterContextUnavailableReason,
    navigator,
    adapter,
    chapterSummaryCache,
    sourcedNoteStore,
    close,
    togglePinned,
    toggleCollapsed,
    setWidth,
  } = useGlossaPanelStore();
  const [isFullHeightInMobile, setIsFullHeightInMobile] = useState(window.innerWidth < 640);
  const [turns, setTurns] = useState<GlossaPanelTurn[]>([]);
  const [question, setQuestion] = useState('');
  const [questionError, setQuestionError] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [navigationSession, setNavigationSession] = useState<AnchorNavigationSession | null>(null);
  const [providerChoice, setProviderChoice] = useState<ProviderChoice>('mock');
  const [contextScope, setContextScope] = useState<ContextScopeChoice>('minimal');
  const [deepSeekStatus, setDeepSeekStatus] = useState({ available: false, configured: false });
  const [deepSeekStatusError, setDeepSeekStatusError] = useState<string | null>(null);
  const [pendingDeepSeekRequest, setPendingDeepSeekRequest] =
    useState<PendingDeepSeekRequest | null>(null);
  const [hasConfirmedDeepSeekScope, setHasConfirmedDeepSeekScope] = useState(false);
  const [isSearchingReadText, setIsSearchingReadText] = useState(false);
  const [requestContextLabel, setRequestContextLabel] = useState<string | null>(null);
  const [savedNotes, setSavedNotes] = useState<GlossaSourcedNote[]>([]);
  const [noteFeedback, setNoteFeedback] = useState<{
    kind: 'success' | 'error' | 'info';
    text: string;
  } | null>(null);
  const [savingNoteId, setSavingNoteId] = useState<string | null>(null);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editedUserNote, setEditedUserNote] = useState('');
  const [updatingNoteId, setUpdatingNoteId] = useState<string | null>(null);
  const [deletingNoteId, setDeletingNoteId] = useState<string | null>(null);
  const [removingNoteId, setRemovingNoteId] = useState<string | null>(null);
  const [exportingNotesFormat, setExportingNotesFormat] = useState<SourcedNotesExportFormat | null>(
    null,
  );
  const nextTurnId = useRef(1);
  const conversationEndRef = useRef<HTMLDivElement | null>(null);
  const requestControllerRef = useRef<GlossaRequestController | null>(null);
  const mockProviderRef = useRef<AIProvider | null>(null);
  const deepSeekProviderRef = useRef<AIProvider | null>(null);
  const activeProviderRef = useRef<AIProvider | null>(null);
  const deepSeekKeyInputRef = useRef<HTMLInputElement | null>(null);
  const retrievalAbortRef = useRef<AbortController | null>(null);
  if (!mockProviderRef.current) mockProviderRef.current = new MockProvider();
  if (!deepSeekProviderRef.current) deepSeekProviderRef.current = new DeepSeekProvider();
  const activeProvider =
    provider ??
    (providerChoice === 'deepseek' ? deepSeekProviderRef.current : mockProviderRef.current);
  const activeContextPack =
    contextScope === 'chapter-to-selection' ? (chapterContextPack ?? contextPack) : contextPack;
  if (!requestControllerRef.current) {
    requestControllerRef.current = new GlossaRequestController(activeProvider);
    activeProviderRef.current = activeProvider;
  }
  const isMobile = window.innerWidth < 640;

  useEffect(() => {
    if (activeProviderRef.current === activeProvider) return;
    requestControllerRef.current?.cancel();
    requestControllerRef.current = new GlossaRequestController(activeProvider);
    activeProviderRef.current = activeProvider;
  }, [activeProvider]);

  const refreshDeepSeekStatus = useCallback(async () => {
    const status = await getDeepSeekKeychainStatus();
    setDeepSeekStatus(status);
    return status;
  }, []);

  useEffect(() => {
    if (provider || providerChoice !== 'deepseek') return;
    void refreshDeepSeekStatus();
  }, [provider, providerChoice, refreshDeepSeekStatus]);

  const handleClose = useCallback(() => {
    retrievalAbortRef.current?.abort();
    requestControllerRef.current?.cancel();
    navigationSession?.dispose();
    setNavigationSession(null);
    setTurns([]);
    setQuestion('');
    setQuestionError(null);
    setErrorMessage(null);
    setPendingDeepSeekRequest(null);
    setHasConfirmedDeepSeekScope(false);
    setRequestContextLabel(null);
    setContextScope('minimal');
    close();
    setIsFullHeightInMobile(isMobile);
  }, [close, isMobile, navigationSession]);

  const { panelRef, overlayRef, panelHeight, handleVerticalDragStart } = useSwipeToDismiss(
    handleClose,
    (data) => setIsFullHeightInMobile(data.clientY < 44),
  );

  const { handleResizeStart, handleResizeKeyDown } = usePanelResize({
    side: 'end',
    minWidth: MIN_GLOSSA_WIDTH,
    maxWidth: MAX_GLOSSA_WIDTH,
    getWidth: () => useGlossaPanelStore.getState().width,
    onResize: setWidth,
  });

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isPinned) handleClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    overlayRef.current = document.querySelector('.glossa-overlay') as HTMLDivElement | null;
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleClose, isOpen, isPinned, overlayRef]);

  useEffect(() => {
    retrievalAbortRef.current?.abort();
    requestControllerRef.current?.cancel();
    navigationSession?.dispose();
    setNavigationSession(null);
    setTurns([]);
    setQuestion('');
    setQuestionError(null);
    setErrorMessage(null);
    setPendingDeepSeekRequest(null);
    setHasConfirmedDeepSeekScope(false);
    setRequestContextLabel(null);
    // A new ContextPack is only created while replacing the live browser
    // selection; clearing an older stream here prevents stale evidence/UI.
  }, [contextPack]);

  useEffect(() => {
    setSavedNotes(sourcedNoteStore?.list() ?? []);
    setNoteFeedback(null);
    setEditingNoteId(null);
    setEditedUserNote('');
    setDeletingNoteId(null);
  }, [sourcedNoteStore]);

  const changeContextScope = useCallback(
    (scope: ContextScopeChoice) => {
      if (scope === contextScope) return;
      if (scope === 'chapter-to-selection' && !chapterContextPack) return;
      retrievalAbortRef.current?.abort();
      requestControllerRef.current?.cancel();
      navigationSession?.dispose();
      setNavigationSession(null);
      setTurns([]);
      setQuestion('');
      setQuestionError(null);
      setErrorMessage(null);
      setPendingDeepSeekRequest(null);
      setHasConfirmedDeepSeekScope(false);
      setRequestContextLabel(null);
      setContextScope(scope);
    },
    [chapterContextPack, contextScope, navigationSession],
  );

  useEffect(() => {
    conversationEndRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [turns]);

  useEffect(
    () => () => {
      retrievalAbortRef.current?.abort();
      requestControllerRef.current?.dispose();
      navigationSession?.dispose();
    },
    [navigationSession],
  );

  const executeRequest = useCallback(
    async (
      request: Pick<AIProviderRequest, 'action' | 'question'>,
      displayQuestion: string,
      retryTurn?: GlossaPanelTurn,
      preparedContextPack?: AIProviderRequest['contextPack'],
    ) => {
      if (!activeContextPack) {
        setErrorMessage(_('Selected context is no longer available.'));
        return;
      }
      requestControllerRef.current?.cancel();
      retrievalAbortRef.current?.abort();
      const retrievalController = new AbortController();
      retrievalAbortRef.current = retrievalController;
      let requestContextPack = retryTurn?.contextPack ?? preparedContextPack ?? activeContextPack;
      if (!retryTurn && request.action === 'summarize-read-section') {
        const section = preparedContextPack ? null : await adapter?.getCurrentReadSectionText();
        const readPack =
          preparedContextPack ??
          (section ? createReadSectionContextPack({ section: section.blocks }) : null);
        if (!readPack) {
          const turnId = nextTurnId.current++;
          setTurns((current) => [
            ...current,
            {
              id: turnId,
              question: displayQuestion,
              status: 'insufficient',
              streamedText: '',
              answer: null,
              errorMessage: null,
              errorCode: null,
              request,
              historySummary: null,
              contextPackId: getContextPackId(activeContextPack),
              contextPack: activeContextPack,
              provider: activeProvider,
            },
          ]);
          setRequestContextLabel(_('本章已读部分 · 无可验证来源 · 未使用后文'));
          return;
        }
        requestContextPack = readPack;
        const modelVersion = getAIProviderModelVersion(activeProvider);
        if (modelVersion && chapterSummaryCache) {
          try {
            const cached = chapterSummaryCache.read({ contextPack: readPack, modelVersion });
            if (cached) {
              const turnId = nextTurnId.current++;
              setTurns((current) => [
                ...current,
                {
                  id: turnId,
                  question: displayQuestion,
                  status:
                    cached.summary.status === 'insufficient_evidence' ? 'insufficient' : 'complete',
                  streamedText: '',
                  answer: cached,
                  errorMessage: null,
                  errorCode: null,
                  request,
                  historySummary: null,
                  contextPackId: getContextPackId(readPack),
                  contextPack: readPack,
                  provider: activeProvider,
                },
              ]);
              setRequestContextLabel(readPack.scopeLabel);
              return;
            }
          } catch {
            // A broken local cache must never block a fresh summary request.
          }
        }
      } else if (!retryTurn && request.question && adapter) {
        setIsSearchingReadText(true);
        try {
          const candidates = [];
          for (const keywordQuery of extractEpubKeywordQueries(request.question)) {
            candidates.push(
              ...(await adapter.searchReadText(keywordQuery, {
                signal: retrievalController.signal,
              })),
            );
            if (retrievalController.signal.aborted) return;
          }
          if (retrievalController.signal.aborted) return;
          requestContextPack = addReadKeywordCandidates({
            contextPack: activeContextPack,
            query: request.question,
            candidates,
          });
        } catch {
          if (retrievalController.signal.aborted) return;
          // Retrieval failure safely falls back to the already verified
          // selection-time pack; it never substitutes unverified evidence.
        } finally {
          if (retrievalAbortRef.current === retrievalController) {
            retrievalAbortRef.current = null;
            setIsSearchingReadText(false);
          }
        }
      }
      if (retrievalController.signal.aborted) return;
      const documentId = requestContextPack.segments[0]?.anchor.documentId;
      const contextPackId = getContextPackId(requestContextPack);
      if (
        retryTurn &&
        (retryTurn.contextPackId !== contextPackId || retryTurn.provider !== activeProvider)
      ) {
        setErrorMessage(
          _('This retry is no longer available because its reading context changed.'),
        );
        return;
      }
      setRequestContextLabel(requestContextPack.scopeLabel);
      const historySummary = retryTurn
        ? retryTurn.historySummary
        : request.action === 'summarize-read-section'
          ? null
          : documentId
            ? createGlossaHistorySummary(
                documentId,
                turns
                  .flatMap((turn) => {
                    if (
                      turn.request.action === 'summarize-read-section' ||
                      !turn.answer ||
                      isChapterSummary(turn.answer) ||
                      (turn.status !== 'complete' && turn.status !== 'insufficient')
                    ) {
                      return [];
                    }
                    return [
                      {
                        documentId: turn.contextPack.segments[0]?.anchor.documentId ?? '',
                        question: turn.question,
                        status:
                          turn.answer.answer.status === 'answered'
                            ? ('answered' as const)
                            : ('insufficient_evidence' as const),
                      },
                    ];
                  })
                  .filter((turn) => turn.documentId === documentId),
              )
            : null;
      const turnId = retryTurn?.id ?? nextTurnId.current++;
      if (retryTurn) {
        setTurns((current) =>
          current.map((turn) =>
            turn.id === turnId
              ? {
                  ...turn,
                  status: 'generating',
                  streamedText: '',
                  answer: null,
                  errorMessage: null,
                  errorCode: null,
                  usage: null,
                  completedAt: null,
                }
              : turn,
          ),
        );
      } else {
        setTurns((current) => [
          ...current,
          {
            id: turnId,
            question: displayQuestion,
            status: 'generating',
            streamedText: '',
            answer: null,
            errorMessage: null,
            errorCode: null,
            request,
            historySummary,
            contextPackId,
            contextPack: requestContextPack,
            provider: activeProvider,
          },
        ]);
      }
      setErrorMessage(null);
      void requestControllerRef.current?.run(
        {
          ...request,
          contextPack: requestContextPack,
          ...(historySummary ? { historySummary } : {}),
        },
        {
          onText: (text) => {
            setTurns((current) =>
              current.map((turn) =>
                turn.id === turnId ? { ...turn, streamedText: turn.streamedText + text } : turn,
              ),
            );
          },
          onRepairing: () =>
            setTurns((current) =>
              current.map((turn) =>
                turn.id === turnId ? { ...turn, status: 'repairing', streamedText: '' } : turn,
              ),
            ),
          onComplete: (result, usage) => {
            setTurns((current) =>
              current.map((turn) =>
                turn.id === turnId
                  ? {
                      ...turn,
                      answer: result,
                      usage,
                      completedAt: new Date(),
                      status: isChapterSummary(result)
                        ? result.summary.status === 'insufficient_evidence'
                          ? 'insufficient'
                          : 'complete'
                        : result.answer.status === 'insufficient_evidence'
                          ? 'insufficient'
                          : 'complete',
                    }
                  : turn,
              ),
            );
            const modelVersion = getAIProviderModelVersion(activeProvider);
            if (isChapterSummary(result) && modelVersion && chapterSummaryCache) {
              try {
                chapterSummaryCache.write({
                  contextPack: requestContextPack,
                  modelVersion,
                  summary: result.summary,
                });
              } catch {
                // Rendering uses the validated result above; cache persistence
                // is opportunistic and must remain invisible on failure.
              }
            }
          },
          onCancelled: () =>
            setTurns((current) =>
              current.map((turn) => (turn.id === turnId ? { ...turn, status: 'cancelled' } : turn)),
            ),
          onError: (error) => {
            setTurns((current) =>
              current.map((turn) =>
                turn.id === turnId
                  ? {
                      ...turn,
                      status: 'error',
                      errorMessage: error.message,
                      errorCode: error.code,
                    }
                  : turn,
              ),
            );
          },
        },
      );
    },
    [_, activeContextPack, activeProvider, adapter, chapterSummaryCache, turns],
  );

  const retryRequest = useCallback(
    (turn: GlossaPanelTurn) => executeRequest(turn.request, turn.question, turn),
    [executeRequest],
  );

  const runRequest = useCallback(
    async (request: Pick<AIProviderRequest, 'action' | 'question'>, displayQuestion: string) => {
      if (provider || providerChoice !== 'deepseek') {
        void executeRequest(request, displayQuestion);
        return;
      }
      const summaryPack =
        request.action === 'summarize-read-section'
          ? await adapter
              ?.getCurrentReadSectionText()
              .then((section) =>
                section ? createReadSectionContextPack({ section: section.blocks }) : null,
              )
          : null;
      if (request.action === 'summarize-read-section' && !summaryPack) {
        void executeRequest(request, displayQuestion);
        return;
      }
      const status = await refreshDeepSeekStatus();
      if (!status.available) {
        setErrorMessage(_('DeepSeek is only available when the system keychain is available.'));
        return;
      }
      if (!status.configured) {
        setErrorMessage(_('Configure a DeepSeek API key before sending reading context.'));
        return;
      }
      if (!hasConfirmedDeepSeekScope) {
        setPendingDeepSeekRequest({
          request,
          label: displayQuestion,
          ...(summaryPack ? { contextPack: summaryPack } : {}),
        });
        return;
      }
      void executeRequest(request, displayQuestion, undefined, summaryPack ?? undefined);
    },
    [
      _,
      adapter,
      executeRequest,
      hasConfirmedDeepSeekScope,
      provider,
      providerChoice,
      refreshDeepSeekStatus,
    ],
  );

  const runAction = useCallback(
    (action: GlossaAction) => {
      const labels: Record<GlossaAction, string> = {
        explain: _('Explain selected text'),
        translate: _('Translate selected text'),
        relate: _('Connect selected text to previous context'),
        'summarize-read-section': _('Summarize read chapter'),
      };
      void runRequest({ action }, labels[action]);
    },
    [_, runRequest],
  );

  const submitQuestion = useCallback(() => {
    const trimmed = question.trim();
    const length = Array.from(question).length;
    if (!trimmed) {
      setQuestionError(_('Enter a question before sending.'));
      return;
    }
    if (length > QUESTION_CHARACTER_LIMIT) {
      setQuestionError(_('Questions must be 2,000 characters or fewer.'));
      return;
    }
    setQuestion('');
    setQuestionError(null);
    void runRequest({ question: trimmed }, trimmed);
  }, [_, question, runRequest]);

  const changeProvider = useCallback((choice: ProviderChoice) => {
    retrievalAbortRef.current?.abort();
    requestControllerRef.current?.cancel();
    setProviderChoice(choice);
    setPendingDeepSeekRequest(null);
    setHasConfirmedDeepSeekScope(false);
    setErrorMessage(null);
    setDeepSeekStatusError(null);
  }, []);

  const saveKey = useCallback(async () => {
    const value = deepSeekKeyInputRef.current?.value ?? '';
    try {
      await saveDeepSeekApiKey(value);
      if (deepSeekKeyInputRef.current) deepSeekKeyInputRef.current.value = '';
      await refreshDeepSeekStatus();
      setDeepSeekStatusError(null);
    } catch (error) {
      setDeepSeekStatusError(
        error instanceof Error ? error.message : _('Could not save the DeepSeek API key.'),
      );
    }
  }, [_, refreshDeepSeekStatus]);

  const deleteKey = useCallback(async () => {
    try {
      await clearDeepSeekApiKey();
      await refreshDeepSeekStatus();
      setDeepSeekStatusError(null);
    } catch (error) {
      setDeepSeekStatusError(
        error instanceof Error ? error.message : _('Could not delete the DeepSeek API key.'),
      );
    }
  }, [_, refreshDeepSeekStatus]);

  const confirmDeepSeekScope = useCallback(() => {
    const pending = pendingDeepSeekRequest;
    if (!pending) return;
    setHasConfirmedDeepSeekScope(true);
    setPendingDeepSeekRequest(null);
    void executeRequest(pending.request, pending.label, undefined, pending.contextPack);
  }, [executeRequest, pendingDeepSeekRequest]);

  const navigateToCitation = useCallback(
    async (citation: LocalCitation) => {
      if (!navigator) return;
      navigationSession?.dispose();
      setNavigationSession(null);
      const session = await navigator.navigate(citation.anchor);
      setNavigationSession(session);
      if (session.result.status !== 'resolved') {
        setErrorMessage(_('Could not return to this source.'));
      }
    },
    [_, navigationSession, navigator],
  );

  const returnToOrigin = useCallback(async () => {
    if (!navigationSession) return;
    const returned = await navigationSession.returnToOrigin();
    if (!returned) setErrorMessage(_('Could not return to the previous reading position.'));
    navigationSession.dispose();
    setNavigationSession(null);
  }, [_, navigationSession]);

  const saveAnswerParagraph = useCallback(
    async (turn: GlossaPanelTurn, paragraphIndex: number) => {
      if (!turn.answer || isChapterSummary(turn.answer)) return;
      if (!sourcedNoteStore) {
        setNoteFeedback({
          kind: 'error',
          text: _('Could not save note: local storage is unavailable.'),
        });
        return;
      }
      const noteKey = `${turn.id}-${paragraphIndex}`;
      setSavingNoteId(noteKey);
      setNoteFeedback(null);
      const result = await sourcedNoteStore.save({
        contextPack: turn.contextPack,
        answer: turn.answer.answer,
        paragraphIndex,
        request: turn.request,
      });
      setSavingNoteId(null);
      if (result.status === 'saved') {
        setSavedNotes(result.notes);
        setNoteFeedback({ kind: 'success', text: _('Note saved locally.') });
      } else if (result.status === 'duplicate') {
        setSavedNotes(result.notes);
        setNoteFeedback({ kind: 'success', text: _('This note is already saved.') });
      } else {
        setNoteFeedback({ kind: 'error', text: _('Could not save note. Please try again.') });
      }
    },
    [_, sourcedNoteStore],
  );

  const beginNoteEdit = useCallback((note: GlossaSourcedNote) => {
    setEditingNoteId(note.id);
    setEditedUserNote(getGlossaSourcedNoteUserNote(note));
    setDeletingNoteId(null);
    setNoteFeedback(null);
  }, []);

  const cancelNoteEdit = useCallback(() => {
    setEditingNoteId(null);
    setEditedUserNote('');
  }, []);

  const saveNoteEdit = useCallback(
    async (id: string) => {
      if (!sourcedNoteStore) {
        setNoteFeedback({
          kind: 'error',
          text: _('Could not update note: local storage is unavailable.'),
        });
        return;
      }
      setUpdatingNoteId(id);
      setNoteFeedback(null);
      const result = await sourcedNoteStore.edit({ id, userNote: editedUserNote });
      setUpdatingNoteId(null);
      if (result.status === 'edited' || result.status === 'unchanged') {
        setSavedNotes(result.notes);
        cancelNoteEdit();
        setNoteFeedback({ kind: 'success', text: _('Note updated locally.') });
      } else {
        setNoteFeedback({ kind: 'error', text: _('Could not update note. Please try again.') });
      }
    },
    [_, cancelNoteEdit, editedUserNote, sourcedNoteStore],
  );

  const confirmNoteDelete = useCallback(
    async (id: string) => {
      if (!sourcedNoteStore) {
        setNoteFeedback({
          kind: 'error',
          text: _('Could not delete note: local storage is unavailable.'),
        });
        return;
      }
      setRemovingNoteId(id);
      setNoteFeedback(null);
      const result = await sourcedNoteStore.remove({ id });
      setRemovingNoteId(null);
      setDeletingNoteId(null);
      if (result.status === 'removed') {
        setSavedNotes(result.notes);
        if (editingNoteId === id) cancelNoteEdit();
        setNoteFeedback({ kind: 'success', text: _('Note deleted locally.') });
      } else {
        setNoteFeedback({ kind: 'error', text: _('Could not delete note. Please try again.') });
      }
    },
    [_, cancelNoteEdit, editingNoteId, sourcedNoteStore],
  );

  const exportSavedNotes = useCallback(
    async (format: SourcedNotesExportFormat) => {
      if (!sourcedNoteStore || savedNotes.length === 0) {
        setNoteFeedback({ kind: 'info', text: _('There are no saved notes to export.') });
        return;
      }
      if (!appService) {
        setNoteFeedback({
          kind: 'error',
          text: _('Could not export notes: file saving is unavailable.'),
        });
        return;
      }

      const documentId = selection?.anchor.documentId;
      if (!documentId) {
        setNoteFeedback({ kind: 'error', text: _('Could not export notes for this document.') });
        return;
      }

      setExportingNotesFormat(format);
      setNoteFeedback(null);
      try {
        const content =
          format === 'json'
            ? serializeGlossaSourcedNotesJson(savedNotes, documentId)
            : serializeGlossaSourcedNotesMarkdown(savedNotes, documentId);
        const safeDocumentId = makeSafeFilename(documentId) || 'document';
        const extension = format === 'json' ? 'json' : 'md';
        const saved = await appService.saveFile(
          `${safeDocumentId}-glossa-notes.${extension}`,
          content,
          { mimeType: format === 'json' ? 'application/json' : 'text/markdown' },
        );
        setNoteFeedback(
          saved
            ? {
                kind: 'success',
                text: format === 'json' ? _('JSON export saved.') : _('Markdown export saved.'),
              }
            : { kind: 'info', text: _('Export cancelled.') },
        );
      } catch {
        setNoteFeedback({ kind: 'error', text: _('Could not export notes. Please try again.') });
      } finally {
        setExportingNotesFormat(null);
      }
    },
    [_, appService, savedNotes, selection?.anchor.documentId, sourcedNoteStore],
  );

  if (!isOpen || !selection) return null;

  const panelWidth = isCollapsed && !isMobile ? '3rem' : width;
  const previewCharacters = Array.from(selection.text);
  const selectionPreview =
    previewCharacters.length > SELECTION_PREVIEW_LIMIT
      ? `${previewCharacters.slice(0, SELECTION_PREVIEW_LIMIT).join('')}…`
      : selection.text;
  const topInset = getPanelTopInset({
    isMobile,
    isFullHeightInMobile,
    systemUIVisible,
    statusBarHeight,
    safeAreaInsets,
  });

  return (
    <>
      {!isPinned && (
        <Overlay
          className={clsx('glossa-overlay z-[46]', isEink ? '' : 'bg-black/50 sm:bg-black/20')}
          onDismiss={handleClose}
        />
      )}
      <aside
        ref={panelRef}
        className={clsx(
          'glossa-panel right-0 z-[46] flex min-w-12 select-none flex-col bg-base-200 shadow-2xl',
          'full-height font-sans text-base font-normal transition-[padding-top,width] duration-300 sm:text-sm',
          isEink && 'border-base-content border-s bg-base-100',
          hasRoundedWindow && 'rounded-window-top-right rounded-window-bottom-right',
          isPinned && 'z-20 shadow-none',
        )}
        aria-label={_('Glossa')}
        dir={dir}
        style={{
          width: isMobile ? '100%' : panelWidth,
          maxWidth: isMobile ? '100%' : `${MAX_GLOSSA_WIDTH * 100}%`,
          position: isMobile ? 'fixed' : isPinned ? 'relative' : 'absolute',
          paddingTop: `${topInset}px`,
        }}
      >
        <style>{`
          @media (max-width: 640px) {
            .glossa-panel {
              border-top-left-radius: 16px;
              border-top-right-radius: 16px;
            }
          }
        `}</style>
        {!isMobile && !isCollapsed && (
          <div
            className='absolute -left-2 top-0 h-full w-0.5 cursor-col-resize bg-transparent p-2'
            role='slider'
            tabIndex={0}
            aria-label={_('Resize Glossa')}
            aria-orientation='horizontal'
            aria-valuenow={parseFloat(width)}
            onMouseDown={handleResizeStart}
            onTouchStart={handleResizeStart}
            onKeyDown={handleResizeKeyDown}
          />
        )}
        {isMobile && (
          <div
            role='slider'
            tabIndex={0}
            aria-label={_('Resize Glossa')}
            aria-orientation='vertical'
            aria-valuenow={panelHeight.current}
            className='flex h-6 max-h-6 min-h-6 w-full cursor-row-resize items-center justify-center'
            onMouseDown={handleVerticalDragStart}
            onTouchStart={handleVerticalDragStart}
          >
            <div className='bg-base-content/50 h-1 w-10 rounded-full' />
          </div>
        )}
        <header className='flex h-11 min-h-11 items-center justify-between px-3'>
          {!isCollapsed && <h2 className='text-sm font-medium'>{_('Glossa')}</h2>}
          <div className={clsx('flex items-center gap-1', isCollapsed && 'w-full justify-center')}>
            {!isMobile && (
              <button
                type='button'
                title={isPinned ? _('Unpin Glossa') : _('Pin Glossa')}
                aria-label={isPinned ? _('Unpin Glossa') : _('Pin Glossa')}
                onClick={togglePinned}
                className={clsx(
                  'btn btn-ghost btn-circle h-7 min-h-7 w-7',
                  isPinned ? 'bg-base-300' : 'bg-base-300/65',
                )}
              >
                {isPinned ? <MdPushPin /> : <MdOutlinePushPin />}
              </button>
            )}
            {!isMobile && (
              <button
                type='button'
                title={isCollapsed ? _('Expand Glossa') : _('Collapse Glossa')}
                aria-label={isCollapsed ? _('Expand Glossa') : _('Collapse Glossa')}
                onClick={toggleCollapsed}
                className='btn btn-ghost btn-circle h-7 min-h-7 w-7'
              >
                {isCollapsed ? <FiChevronLeft /> : <FiChevronRight />}
              </button>
            )}
            <button
              type='button'
              title={_('Close')}
              aria-label={_('Close Glossa')}
              onClick={handleClose}
              className='btn btn-ghost btn-circle h-7 min-h-7 w-7'
            >
              <FiX />
            </button>
          </div>
        </header>
        {!isCollapsed && (
          <div className='flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-5 pt-3'>
            <section aria-label={_('Selected text')}>
              <p className='text-base-content/60 mb-1 text-xs font-medium uppercase tracking-wide'>
                {_('Selected text')}
              </p>
              <blockquote className='border-base-content/30 border-s-2 ps-3 text-sm leading-6 break-words'>
                {selectionPreview}
              </blockquote>
            </section>
            <section aria-label={_('Glossa context')}>
              <p className='text-base-content/60 mb-1 text-xs font-medium uppercase tracking-wide'>
                {_('Context')}
              </p>
              <p className='text-base-content/65 text-sm leading-6'>
                {requestContextLabel ??
                  activeContextPack?.scopeLabel ??
                  _('Selected context is no longer available.')}
              </p>
              {isSearchingReadText && (
                <p role='status' className='text-base-content/60 mt-2 text-xs'>
                  {_('Searching verified read text…')}
                </p>
              )}
              <div
                className='mt-2 flex flex-wrap gap-2'
                role='radiogroup'
                aria-label={_('Context range')}
              >
                <button
                  type='button'
                  role='radio'
                  aria-checked={contextScope === 'minimal'}
                  className={clsx(
                    'btn btn-sm',
                    contextScope === 'minimal' ? 'btn-contrast' : 'btn-ghost',
                  )}
                  onClick={() => changeContextScope('minimal')}
                >
                  {_('最小范围')}
                </button>
                <button
                  type='button'
                  role='radio'
                  aria-checked={contextScope === 'chapter-to-selection'}
                  disabled={!chapterContextPack}
                  title={chapterContextUnavailableReason ?? undefined}
                  className={clsx(
                    'btn btn-sm',
                    contextScope === 'chapter-to-selection' ? 'btn-contrast' : 'btn-ghost',
                  )}
                  onClick={() => changeContextScope('chapter-to-selection')}
                >
                  {_('本章开头至选区')}
                </button>
              </div>
              {chapterContextUnavailableReason && !chapterContextPack && (
                <p className='text-base-content/60 mt-2 text-xs'>
                  {_(chapterContextUnavailableReason)}
                </p>
              )}
            </section>
            {!provider && (
              <section aria-label={_('Glossa provider')} className='space-y-2'>
                <p className='text-base-content/60 text-xs font-medium uppercase tracking-wide'>
                  {_('Provider')}
                </p>
                <div className='flex flex-wrap gap-2' role='radiogroup' aria-label={_('Provider')}>
                  <button
                    type='button'
                    role='radio'
                    aria-checked={providerChoice === 'mock'}
                    className={clsx(
                      'btn btn-sm',
                      providerChoice === 'mock' ? 'btn-contrast' : 'btn-ghost',
                    )}
                    onClick={() => changeProvider('mock')}
                  >
                    {_('Mock')}
                  </button>
                  <button
                    type='button'
                    role='radio'
                    aria-checked={providerChoice === 'deepseek'}
                    className={clsx(
                      'btn btn-sm',
                      providerChoice === 'deepseek' ? 'btn-contrast' : 'btn-ghost',
                    )}
                    onClick={() => changeProvider('deepseek')}
                  >
                    {_('DeepSeek')}
                  </button>
                </div>
                {providerChoice === 'deepseek' && (
                  <div className='eink-bordered space-y-2 rounded-lg border p-3 text-sm'>
                    <p className='text-base-content/65'>
                      {deepSeekStatus.available
                        ? deepSeekStatus.configured
                          ? _('DeepSeek API key: configured')
                          : _('DeepSeek API key: not configured')
                        : _('DeepSeek is unavailable because the system keychain is unavailable.')}
                    </p>
                    {deepSeekStatus.available && (
                      <>
                        <label
                          className='text-base-content/60 text-xs font-medium'
                          htmlFor='glossa-deepseek-key'
                        >
                          {_('DeepSeek API key')}
                        </label>
                        <input
                          ref={deepSeekKeyInputRef}
                          id='glossa-deepseek-key'
                          type='password'
                          autoComplete='off'
                          className='input input-bordered eink-bordered w-full text-sm'
                          placeholder={_('Paste API key')}
                        />
                        <div className='flex flex-wrap gap-2'>
                          <button
                            type='button'
                            className='btn btn-contrast btn-sm'
                            onClick={() => void saveKey()}
                          >
                            {_('Save key')}
                          </button>
                          <button
                            type='button'
                            className='btn btn-ghost btn-sm'
                            disabled={!deepSeekStatus.configured}
                            onClick={() => void deleteKey()}
                          >
                            {_('Delete key')}
                          </button>
                        </div>
                      </>
                    )}
                    {deepSeekStatusError && (
                      <p role='alert' className='text-error'>
                        {deepSeekStatusError}
                      </p>
                    )}
                  </div>
                )}
              </section>
            )}
            {pendingDeepSeekRequest && (
              <section
                aria-label={_('DeepSeek privacy confirmation')}
                className='eink-bordered space-y-2 rounded-lg border p-3 text-sm'
              >
                <p className='font-medium'>{_('Confirm sending reading context')}</p>
                <p className='text-base-content/65 leading-6'>
                  {_(
                    `Will send: ${(pendingDeepSeekRequest.contextPack ?? activeContextPack)?.scopeLabel ?? _('selected context')} (${(pendingDeepSeekRequest.contextPack ?? activeContextPack)?.segments.length ?? 0} segments)${pendingDeepSeekRequest.request.action === 'summarize-read-section' ? '' : ' and a short summary of prior questions in this document'}. It will not send selection-later text, earlier answer prose, the whole book, or notes.`,
                  )}
                </p>
                <p className='text-base-content/65 leading-6'>
                  {_(
                    'If the answer structure is invalid, Glossa may repair it once, which may make a second model call.',
                  )}
                </p>
                <div className='flex gap-2'>
                  <button
                    type='button'
                    className='btn btn-contrast btn-sm'
                    onClick={confirmDeepSeekScope}
                  >
                    {_('Send to DeepSeek')}
                  </button>
                  <button
                    type='button'
                    className='btn btn-ghost btn-sm'
                    onClick={() => setPendingDeepSeekRequest(null)}
                  >
                    {_('Cancel')}
                  </button>
                </div>
              </section>
            )}
            <form
              className='flex flex-col gap-2'
              aria-label={_('Ask Glossa')}
              onSubmit={(event) => {
                event.preventDefault();
                submitQuestion();
              }}
            >
              <label
                className='text-base-content/60 text-xs font-medium uppercase tracking-wide'
                htmlFor='glossa-question'
              >
                {_('Ask Glossa')}
              </label>
              <textarea
                id='glossa-question'
                value={question}
                rows={3}
                className='textarea textarea-bordered eink-bordered w-full resize-y text-sm leading-6'
                placeholder={_('Ask about the selected text')}
                aria-describedby='glossa-question-help'
                onChange={(event) => {
                  const nextQuestion = event.target.value;
                  setQuestion(nextQuestion);
                  setQuestionError(
                    Array.from(nextQuestion).length > QUESTION_CHARACTER_LIMIT
                      ? _('Questions must be 2,000 characters or fewer.')
                      : null,
                  );
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    submitQuestion();
                  }
                }}
              />
              <div
                id='glossa-question-help'
                className='flex items-center justify-between gap-2 text-xs'
              >
                <span className={questionError ? 'text-error' : 'text-base-content/60'}>
                  {questionError ?? _('Enter to send · Shift+Enter for a new line')}
                </span>
                <span className='text-base-content/60'>
                  {Array.from(question).length}/{QUESTION_CHARACTER_LIMIT}
                </span>
              </div>
              <button
                type='submit'
                className='btn btn-contrast btn-sm self-end'
                disabled={
                  !question.trim() ||
                  Array.from(question).length > QUESTION_CHARACTER_LIMIT ||
                  !contextPack
                }
              >
                {_('Send')}
              </button>
            </form>
            <div className='flex flex-wrap gap-2' aria-label={_('Glossa actions')}>
              {(
                [
                  ['explain', _('Explain')],
                  ['translate', _('Translate')],
                  ['relate', _('Connect to previous')],
                  ['summarize-read-section', _('Summarize read chapter')],
                ] as const
              ).map(([action, label]) => (
                <button
                  key={action}
                  type='button'
                  className='btn btn-contrast btn-sm'
                  disabled={!contextPack || (action === 'summarize-read-section' && !adapter)}
                  onClick={() => runAction(action)}
                >
                  {label}
                </button>
              ))}
              {turns.some(
                (turn) => turn.status === 'generating' || turn.status === 'repairing',
              ) && (
                <button
                  type='button'
                  className='btn btn-ghost btn-sm'
                  onClick={() => requestControllerRef.current?.cancel()}
                >
                  {_('Cancel')}
                </button>
              )}
            </div>
            {errorMessage && (
              <p role='alert' className='text-error text-sm'>
                {errorMessage}
              </p>
            )}
            {noteFeedback && (
              <p
                role={noteFeedback.kind === 'error' ? 'alert' : 'status'}
                className={
                  noteFeedback.kind === 'error'
                    ? 'text-error text-sm'
                    : 'text-base-content/65 text-sm'
                }
              >
                {noteFeedback.text}
              </p>
            )}
            <section aria-label={_('Glossa conversation')} className='space-y-4'>
              {turns.map((turn) => (
                <article key={turn.id} className='space-y-2'>
                  <div className='bg-base-300/60 eink-bordered rounded-lg px-3 py-2 text-sm leading-6 break-words'>
                    <p className='text-base-content/60 mb-1 text-xs font-medium'>{_('You')}</p>
                    {turn.question}
                  </div>
                  <div className='border-base-content/20 border-s-2 ps-3 text-sm leading-6 break-words'>
                    <p className='text-base-content/60 mb-1 text-xs font-medium'>{_('Glossa')}</p>
                    {turn.status === 'generating' && (
                      <div aria-live='polite'>
                        <p className='text-base-content/65'>{_('Glossa is responding…')}</p>
                        {turn.streamedText && <p className='mt-2'>{turn.streamedText}</p>}
                      </div>
                    )}
                    {turn.status === 'repairing' && (
                      <p role='status' aria-live='polite' className='text-base-content/65'>
                        {_('Repairing answer (1/1)…')}
                      </p>
                    )}
                    {turn.status === 'cancelled' && (
                      <p role='status' className='text-base-content/65'>
                        {_('Request cancelled.')}
                      </p>
                    )}
                    {turn.status === 'error' && (
                      <div className='space-y-2'>
                        <p role='alert' className='text-error'>
                          {turn.errorMessage ?? _('Glossa could not complete this request.')}
                        </p>
                        {turn.errorCode &&
                          errorGuidance({ code: turn.errorCode, message: '' }, _) && (
                            <p className='text-base-content/65'>
                              {errorGuidance({ code: turn.errorCode, message: '' }, _)}
                            </p>
                          )}
                        {canManuallyRetry(turn.errorCode) && (
                          <button
                            type='button'
                            className='btn btn-ghost btn-sm'
                            onClick={() => retryRequest(turn)}
                          >
                            {_('Retry')}
                          </button>
                        )}
                      </div>
                    )}
                    {turn.status === 'insufficient' && (
                      <p role='status' className='text-base-content/65'>
                        {turn.request.action === 'summarize-read-section'
                          ? _(
                              'Evidence insufficient: no verified read text is available in this chapter.',
                            )
                          : _(
                              'Evidence insufficient: the current context does not support this question.',
                            )}
                      </p>
                    )}
                    {turn.status === 'complete' &&
                      turn.answer &&
                      (isChapterSummary(turn.answer) ? (
                        <div className='space-y-3'>
                          <div>
                            <p className='text-base-content/60 text-xs font-medium uppercase tracking-wide'>
                              {_('Core points')}
                            </p>
                            <ul className='mt-1 list-disc space-y-1 ps-5'>
                              {turn.answer.summary.corePoints.map((item, corePointIndex) => {
                                const answer = turn.answer;
                                if (!isChapterSummary(answer)) return null;
                                return (
                                  <li key={item.text}>
                                    <p>{item.text}</p>
                                    <div
                                      className='mt-1 flex flex-col items-start gap-1'
                                      aria-label={`${_('Core point sources')} ${turn.id}-${corePointIndex + 1}`}
                                    >
                                      {answer.corePointCitations[corePointIndex]!.map(
                                        (citation, citationIndex) => (
                                          <button
                                            key={citation.sourceId}
                                            type='button'
                                            className='btn btn-ghost h-auto min-h-0 max-w-full justify-start px-2 py-1 text-left text-xs'
                                            aria-label={`${_('Core point source')} ${turn.id}-${corePointIndex + 1}-${citationIndex + 1}`}
                                            disabled={!navigator}
                                            onClick={() => void navigateToCitation(citation)}
                                          >
                                            <span className='font-medium'>
                                              {_('Source')} {citationIndex + 1}:{' '}
                                            </span>
                                            <span className='truncate'>
                                              {Array.from(citation.text).slice(0, 140).join('')}
                                            </span>
                                          </button>
                                        ),
                                      )}
                                    </div>
                                  </li>
                                );
                              })}
                            </ul>
                          </div>
                          <div>
                            <p className='text-base-content/60 text-xs font-medium uppercase tracking-wide'>
                              {_('Evidence')}
                            </p>
                            <ul className='mt-1 list-disc space-y-1 ps-5'>
                              {turn.answer.summary.evidence.map((item) => (
                                <li key={item.text}>{item.text}</li>
                              ))}
                            </ul>
                          </div>
                          {turn.answer.summary.concepts.length > 0 && (
                            <div>
                              <p className='text-base-content/60 text-xs font-medium uppercase tracking-wide'>
                                {_('Concepts')}
                              </p>
                              <dl className='mt-1 space-y-1'>
                                {turn.answer.summary.concepts.map((concept) => (
                                  <div key={concept.term}>
                                    <dt className='font-medium'>{concept.term}</dt>
                                    <dd>{concept.explanation}</dd>
                                  </div>
                                ))}
                              </dl>
                            </div>
                          )}
                          {turn.answer.summary.openQuestions.length > 0 && (
                            <div>
                              <p className='text-base-content/60 text-xs font-medium uppercase tracking-wide'>
                                {_('Open questions')}
                              </p>
                              <ul className='mt-1 list-disc space-y-1 ps-5'>
                                {turn.answer.summary.openQuestions.map((item) => (
                                  <li key={item.text}>{item.text}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      ) : (
                        <>
                          {turn.answer.answer.paragraphs.map((paragraph, index) => {
                            const basis =
                              paragraph.basis === 'document' ? _('原文') : _('基于原文的推断');
                            const citations = turn.answer!.citations.filter((citation) =>
                              paragraph.sourceIds.includes(citation.sourceId),
                            );
                            return (
                              <div key={`${paragraph.text}-${index}`} className='mb-3 last:mb-0'>
                                <span
                                  className='badge badge-ghost mb-1 text-xs'
                                  aria-label={`${_('Paragraph basis')}: ${basis}`}
                                >
                                  {basis}
                                </span>
                                <p>{paragraph.text}</p>
                                <button
                                  type='button'
                                  className='btn btn-ghost btn-sm mt-1'
                                  disabled={savingNoteId === `${turn.id}-${index}`}
                                  onClick={() => void saveAnswerParagraph(turn, index)}
                                >
                                  {savingNoteId === `${turn.id}-${index}`
                                    ? _('Saving note…')
                                    : _('Save as note')}
                                </button>
                                <div
                                  className='mt-2 flex flex-col items-start gap-2'
                                  aria-label={_('Sources')}
                                >
                                  {citations.map((citation) => {
                                    const citationIndex = turn.answer!.citations.findIndex(
                                      ({ sourceId }) => sourceId === citation.sourceId,
                                    );
                                    return (
                                      <button
                                        key={citation.sourceId}
                                        type='button'
                                        className='btn btn-ghost h-auto min-h-0 max-w-full justify-start px-2 py-1 text-left text-xs'
                                        aria-label={`${_('Source')} ${turn.id}-${citationIndex + 1}`}
                                        disabled={!navigator}
                                        onClick={() => void navigateToCitation(citation)}
                                      >
                                        <span className='font-medium'>
                                          {_('Source')} {citationIndex + 1}:{' '}
                                        </span>
                                        <span className='truncate'>
                                          {Array.from(citation.text).slice(0, 140).join('')}
                                        </span>
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })}
                        </>
                      ))}
                    {['complete', 'insufficient', 'cancelled', 'error'].includes(turn.status) && (
                      <UsageEstimate
                        completedAt={turn.completedAt}
                        provider={turn.provider}
                        translate={_}
                        usage={turn.usage}
                      />
                    )}
                  </div>
                </article>
              ))}
              <div ref={conversationEndRef} aria-hidden='true' />
            </section>
            {sourcedNoteStore && (
              <section aria-label={_('Saved Glossa notes')} className='space-y-3'>
                <p className='text-base-content/60 text-xs font-medium uppercase tracking-wide'>
                  {_('Saved notes')}
                </p>
                <div className='flex flex-wrap gap-2' aria-label={_('Export saved notes')}>
                  <button
                    type='button'
                    className='btn btn-ghost btn-sm'
                    disabled={
                      !appService || savedNotes.length === 0 || exportingNotesFormat !== null
                    }
                    onClick={() => void exportSavedNotes('markdown')}
                  >
                    {exportingNotesFormat === 'markdown'
                      ? _('Exporting Markdown…')
                      : _('Export Markdown')}
                  </button>
                  <button
                    type='button'
                    className='btn btn-ghost btn-sm'
                    disabled={
                      !appService || savedNotes.length === 0 || exportingNotesFormat !== null
                    }
                    onClick={() => void exportSavedNotes('json')}
                  >
                    {exportingNotesFormat === 'json' ? _('Exporting JSON…') : _('Export JSON')}
                  </button>
                </div>
                {savedNotes.length === 0 && (
                  <p className='text-base-content/65 text-sm'>
                    {_('No saved notes are available to export for this document.')}
                  </p>
                )}
                {!appService && savedNotes.length > 0 && (
                  <p className='text-base-content/65 text-sm'>
                    {_('File saving is unavailable, so these notes cannot be exported here.')}
                  </p>
                )}
                {savedNotes.map((note, noteIndex) => (
                  <article
                    key={note.id}
                    className='eink-bordered space-y-2 rounded-lg border p-3 text-sm'
                  >
                    {(() => {
                      const original = getGlossaSourcedNoteOriginal(note);
                      const isEditing = editingNoteId === note.id;
                      const isDeleting = deletingNoteId === note.id;
                      return (
                        <>
                          {original.version === 2 ? (
                            <div aria-label={_('Saved note context')} className='space-y-1'>
                              <p className='text-base-content/60 text-xs font-medium uppercase tracking-wide'>
                                {_('Request')}
                              </p>
                              <p>
                                {'action' in original.context.request
                                  ? {
                                      explain: _('Explain selected text'),
                                      translate: _('Translate selected text'),
                                      relate: _('Connect selected text to previous context'),
                                    }[original.context.request.action]
                                  : original.context.request.question}
                              </p>
                              <blockquote className='border-base-content/30 border-s-2 ps-2 text-xs leading-5 break-words'>
                                {original.context.selection.text}
                              </blockquote>
                            </div>
                          ) : (
                            <p
                              aria-label={_('Saved note context')}
                              className='text-base-content/65 text-xs'
                            >
                              {_('This older saved note has no request context.')}
                            </p>
                          )}
                          <p>{original.version === 2 ? original.answer.text : original.answer}</p>
                          {isEditing ? (
                            <div className='space-y-2'>
                              <label
                                className='text-base-content/60 text-xs font-medium'
                                htmlFor={`glossa-note-${note.id}`}
                              >
                                {_('Your note')}
                              </label>
                              <textarea
                                id={`glossa-note-${note.id}`}
                                value={editedUserNote}
                                rows={3}
                                maxLength={20_000}
                                className='textarea textarea-bordered eink-bordered w-full resize-y text-sm leading-6'
                                onChange={(event) => setEditedUserNote(event.target.value)}
                              />
                              <div className='flex flex-wrap gap-2'>
                                <button
                                  type='button'
                                  className='btn btn-contrast btn-sm'
                                  disabled={updatingNoteId === note.id}
                                  onClick={() => void saveNoteEdit(note.id)}
                                >
                                  {updatingNoteId === note.id
                                    ? _('Saving note…')
                                    : _('Save note changes')}
                                </button>
                                <button
                                  type='button'
                                  className='btn btn-ghost btn-sm'
                                  onClick={cancelNoteEdit}
                                >
                                  {_('Cancel edit')}
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className='space-y-1'>
                              <p className='text-base-content/60 text-xs font-medium uppercase tracking-wide'>
                                {_('Your note')}
                              </p>
                              <p className='text-base-content/65 whitespace-pre-wrap'>
                                {getGlossaSourcedNoteUserNote(note) || _('No personal note yet.')}
                              </p>
                              <div className='flex flex-wrap gap-2'>
                                <button
                                  type='button'
                                  className='btn btn-ghost btn-sm'
                                  onClick={() => beginNoteEdit(note)}
                                >
                                  {_('Edit note')}
                                </button>
                                <button
                                  type='button'
                                  className='btn btn-ghost btn-sm'
                                  onClick={() => {
                                    setDeletingNoteId(note.id);
                                    setEditingNoteId(null);
                                    setNoteFeedback(null);
                                  }}
                                >
                                  {_('Delete note')}
                                </button>
                              </div>
                            </div>
                          )}
                          {isDeleting && (
                            <div
                              className='eink-bordered space-y-2 rounded border p-2'
                              aria-label={_('Delete saved note confirmation')}
                            >
                              <p className='font-medium'>{_('Delete this saved note?')}</p>
                              <p className='text-base-content/65 text-xs'>
                                {_(
                                  'This removes the local saved note and its personal note. The original answer and sources cannot be recovered from this entry.',
                                )}
                              </p>
                              <div className='flex flex-wrap gap-2'>
                                <button
                                  type='button'
                                  className='btn btn-contrast btn-sm'
                                  disabled={removingNoteId === note.id}
                                  onClick={() => void confirmNoteDelete(note.id)}
                                >
                                  {removingNoteId === note.id
                                    ? _('Deleting note…')
                                    : _('Delete permanently')}
                                </button>
                                <button
                                  type='button'
                                  className='btn btn-ghost btn-sm'
                                  disabled={removingNoteId === note.id}
                                  onClick={() => setDeletingNoteId(null)}
                                >
                                  {_('Keep note')}
                                </button>
                              </div>
                            </div>
                          )}
                          <div
                            className='flex flex-col items-start gap-1'
                            aria-label={_('Saved note sources')}
                          >
                            {original.sources.map((source, sourceIndex) => (
                              <button
                                key={source.sourceId}
                                type='button'
                                className='btn btn-ghost h-auto min-h-0 max-w-full justify-start px-2 py-1 text-left text-xs'
                                aria-label={`${_('Saved note source')} ${noteIndex + 1}-${sourceIndex + 1}`}
                                disabled={!navigator}
                                onClick={() => void navigateToCitation(source)}
                              >
                                <span className='font-medium'>
                                  {_('Source')} {sourceIndex + 1}:{' '}
                                </span>
                                <span className='truncate'>
                                  {Array.from(source.text).slice(0, 140).join('')}
                                </span>
                              </button>
                            ))}
                          </div>
                        </>
                      );
                    })()}
                  </article>
                ))}
              </section>
            )}
            {navigationSession?.result.status === 'resolved' &&
              navigationSession.result.canReturn && (
                <button
                  type='button'
                  className='btn btn-ghost btn-sm self-start'
                  onClick={() => void returnToOrigin()}
                >
                  {_('Return to reading position')}
                </button>
              )}
          </div>
        )}
      </aside>
    </>
  );
};

export default GlossaPanel;
