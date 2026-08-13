import clsx from 'clsx';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FiChevronLeft, FiChevronRight, FiX } from 'react-icons/fi';
import { MdOutlinePushPin, MdPushPin } from 'react-icons/md';

import { Overlay } from '@/components/Overlay';
import { usePanelResize } from '@/hooks/usePanelResize';
import { useSwipeToDismiss } from '@/hooks/useSwipeToDismiss';
import { useTranslation } from '@/hooks/useTranslation';
import { getPanelTopInset } from '@/utils/insets';
import type { Insets } from '@/types/misc';
import {
  DeepSeekProvider,
  GlossaRequestController,
  MockProvider,
  clearDeepSeekApiKey,
  getDeepSeekKeychainStatus,
  saveDeepSeekApiKey,
  type AIProvider,
  type AIProviderRequest,
  type GlossaConversationTurn,
  type GlossaAction,
  type ProviderError,
  getContextPackId,
  type ValidatedGlossaAnswer,
} from '../ai';
import type { AnchorNavigationSession } from '../citations/navigation';
import { isGlossaEnabled } from '../featureFlag';
import { useGlossaPanelStore } from './glossaPanelStore';

const MIN_GLOSSA_WIDTH = 0.22;
const MAX_GLOSSA_WIDTH = 0.45;
const SELECTION_PREVIEW_LIMIT = 500;
const QUESTION_CHARACTER_LIMIT = 2000;

type ProviderChoice = 'mock' | 'deepseek';
type ContextScopeChoice = 'minimal' | 'chapter-to-selection';

type PendingDeepSeekRequest = {
  request: Pick<AIProviderRequest, 'action' | 'question'>;
  label: string;
};

type TurnStatus = 'generating' | 'repairing' | 'complete' | 'insufficient' | 'cancelled' | 'error';

type GlossaPanelTurn = {
  id: number;
  question: string;
  status: TurnStatus;
  streamedText: string;
  answer: ValidatedGlossaAnswer | null;
  errorMessage: string | null;
  errorCode: ProviderError['code'] | null;
  request: Pick<AIProviderRequest, 'action' | 'question'>;
  history: GlossaConversationTurn[];
  contextPackId: string;
  provider: AIProvider;
};

const canManuallyRetry = (code: ProviderError['code'] | null): boolean =>
  code === 'rate-limited' ||
  code === 'server-error' ||
  code === 'overloaded' ||
  code === 'timeout' ||
  code === 'network-error';

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

type GlossaPanelProps = {
  dir?: 'ltr' | 'rtl';
  isEink?: boolean;
  hasRoundedWindow?: boolean;
  safeAreaInsets: Insets | null;
  systemUIVisible: boolean;
  statusBarHeight: number;
  provider?: AIProvider;
};

const GlossaPanel: React.FC<GlossaPanelProps> = ({
  dir = 'ltr',
  isEink = false,
  hasRoundedWindow = false,
  safeAreaInsets,
  systemUIVisible,
  statusBarHeight,
  provider,
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
  const nextTurnId = useRef(1);
  const conversationEndRef = useRef<HTMLDivElement | null>(null);
  const requestControllerRef = useRef<GlossaRequestController | null>(null);
  const mockProviderRef = useRef<AIProvider | null>(null);
  const deepSeekProviderRef = useRef<AIProvider | null>(null);
  const activeProviderRef = useRef<AIProvider | null>(null);
  const deepSeekKeyInputRef = useRef<HTMLInputElement | null>(null);
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
    requestControllerRef.current?.cancel();
    navigationSession?.dispose();
    setNavigationSession(null);
    setTurns([]);
    setQuestion('');
    setQuestionError(null);
    setErrorMessage(null);
    setPendingDeepSeekRequest(null);
    setHasConfirmedDeepSeekScope(false);
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
    requestControllerRef.current?.cancel();
    navigationSession?.dispose();
    setNavigationSession(null);
    setTurns([]);
    setQuestion('');
    setQuestionError(null);
    setErrorMessage(null);
    setPendingDeepSeekRequest(null);
    setHasConfirmedDeepSeekScope(false);
    // A new ContextPack is only created while replacing the live browser
    // selection; clearing an older stream here prevents stale evidence/UI.
  }, [contextPack]);

  const changeContextScope = useCallback(
    (scope: ContextScopeChoice) => {
      if (scope === contextScope) return;
      if (scope === 'chapter-to-selection' && !chapterContextPack) return;
      requestControllerRef.current?.cancel();
      navigationSession?.dispose();
      setNavigationSession(null);
      setTurns([]);
      setQuestion('');
      setQuestionError(null);
      setErrorMessage(null);
      setPendingDeepSeekRequest(null);
      setHasConfirmedDeepSeekScope(false);
      setContextScope(scope);
    },
    [chapterContextPack, contextScope, navigationSession],
  );

  useEffect(() => {
    conversationEndRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [turns]);

  useEffect(
    () => () => {
      requestControllerRef.current?.dispose();
      navigationSession?.dispose();
    },
    [navigationSession],
  );

  const executeRequest = useCallback(
    (
      request: Pick<AIProviderRequest, 'action' | 'question'>,
      displayQuestion: string,
      retryTurn?: GlossaPanelTurn,
    ) => {
      if (!activeContextPack) {
        setErrorMessage(_('Selected context is no longer available.'));
        return;
      }
      const documentId = activeContextPack.segments[0]?.anchor.documentId;
      const contextPackId = getContextPackId(activeContextPack);
      if (
        retryTurn &&
        (retryTurn.contextPackId !== contextPackId || retryTurn.provider !== activeProvider)
      ) {
        setErrorMessage(
          _('This retry is no longer available because its reading context changed.'),
        );
        return;
      }
      const history =
        retryTurn?.history ??
        turns
          .filter(
            (turn) => turn.answer && (turn.status === 'complete' || turn.status === 'insufficient'),
          )
          .slice(-3)
          .flatMap((turn) =>
            documentId
              ? [
                  {
                    documentId,
                    contextPackId,
                    user: { role: 'user' as const, text: turn.question },
                    assistant: {
                      role: 'assistant' as const,
                      text:
                        turn.answer!.answer.status === 'answered'
                          ? turn.answer!.answer.paragraphs.map(({ text }) => text).join('\n')
                          : turn.streamedText,
                      answer: turn.answer!.answer,
                    },
                  },
                ]
              : [],
          );
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
            history,
            contextPackId,
            provider: activeProvider,
          },
        ]);
      }
      setErrorMessage(null);
      void requestControllerRef.current?.run(
        { ...request, contextPack: activeContextPack, history },
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
          onComplete: (result) => {
            setTurns((current) =>
              current.map((turn) =>
                turn.id === turnId
                  ? {
                      ...turn,
                      answer: result,
                      status:
                        result.answer.status === 'insufficient_evidence'
                          ? 'insufficient'
                          : 'complete',
                    }
                  : turn,
              ),
            );
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
    [_, activeContextPack, activeProvider, turns],
  );

  const retryRequest = useCallback(
    (turn: GlossaPanelTurn) => executeRequest(turn.request, turn.question, turn),
    [executeRequest],
  );

  const runRequest = useCallback(
    async (request: Pick<AIProviderRequest, 'action' | 'question'>, displayQuestion: string) => {
      if (provider || providerChoice !== 'deepseek') {
        executeRequest(request, displayQuestion);
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
        setPendingDeepSeekRequest({ request, label: displayQuestion });
        return;
      }
      executeRequest(request, displayQuestion);
    },
    [_, executeRequest, hasConfirmedDeepSeekScope, provider, providerChoice, refreshDeepSeekStatus],
  );

  const runAction = useCallback(
    (action: GlossaAction) => {
      const labels: Record<GlossaAction, string> = {
        explain: _('Explain selected text'),
        translate: _('Translate selected text'),
        relate: _('Connect selected text to previous context'),
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
    executeRequest(pending.request, pending.label);
  }, [executeRequest, pendingDeepSeekRequest]);

  const navigateToCitation = useCallback(
    async (citation: NonNullable<ValidatedGlossaAnswer['citations'][number]>) => {
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
                {activeContextPack?.scopeLabel ?? _('Selected context is no longer available.')}
              </p>
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
                    `Will send: ${activeContextPack?.scopeLabel ?? _('selected context')} (${activeContextPack?.segments.length ?? 0} segments) + up to 3 recent conversation turns. It will not send selection-later text, the whole book, or notes.`,
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
                ] as const
              ).map(([action, label]) => (
                <button
                  key={action}
                  type='button'
                  className='btn btn-contrast btn-sm'
                  disabled={!contextPack}
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
                        {_(
                          'Evidence insufficient: the current context does not support this question.',
                        )}
                      </p>
                    )}
                    {turn.status === 'complete' && turn.answer && (
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
                    )}
                  </div>
                </article>
              ))}
              <div ref={conversationEndRef} aria-hidden='true' />
            </section>
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
