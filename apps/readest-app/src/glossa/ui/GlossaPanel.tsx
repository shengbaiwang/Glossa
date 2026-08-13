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
  GlossaRequestController,
  MockProvider,
  type AIProvider,
  type GlossaAction,
  type ValidatedGlossaAnswer,
} from '../ai';
import type { AnchorNavigationSession } from '../citations/navigation';
import { isGlossaEnabled } from '../featureFlag';
import { useGlossaPanelStore } from './glossaPanelStore';

const MIN_GLOSSA_WIDTH = 0.22;
const MAX_GLOSSA_WIDTH = 0.45;
const SELECTION_PREVIEW_LIMIT = 500;

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
    navigator,
    close,
    togglePinned,
    toggleCollapsed,
    setWidth,
  } = useGlossaPanelStore();
  const [isFullHeightInMobile, setIsFullHeightInMobile] = useState(window.innerWidth < 640);
  const [requestState, setRequestState] = useState<
    'idle' | 'loading' | 'streaming' | 'complete' | 'insufficient' | 'cancelled' | 'error'
  >('idle');
  const [streamedText, setStreamedText] = useState('');
  const [answer, setAnswer] = useState<ValidatedGlossaAnswer | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [navigationSession, setNavigationSession] = useState<AnchorNavigationSession | null>(null);
  const requestControllerRef = useRef<GlossaRequestController | null>(null);
  if (!requestControllerRef.current) {
    requestControllerRef.current = new GlossaRequestController(provider ?? new MockProvider());
  }
  const isMobile = window.innerWidth < 640;

  const handleClose = useCallback(() => {
    requestControllerRef.current?.cancel();
    navigationSession?.dispose();
    setNavigationSession(null);
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
    setRequestState('idle');
    setStreamedText('');
    setAnswer(null);
    setErrorMessage(null);
    // A new ContextPack is only created while replacing the live browser
    // selection; clearing an older stream here prevents stale evidence/UI.
  }, [contextPack]);

  useEffect(
    () => () => {
      requestControllerRef.current?.dispose();
      navigationSession?.dispose();
    },
    [navigationSession],
  );

  const runAction = useCallback(
    (action: GlossaAction) => {
      if (!contextPack) {
        setRequestState('error');
        setErrorMessage(_('Selected context is no longer available.'));
        return;
      }
      setRequestState('loading');
      setStreamedText('');
      setAnswer(null);
      setErrorMessage(null);
      void requestControllerRef.current?.run(
        { action, contextPack },
        {
          onText: (text) => {
            setRequestState('streaming');
            setStreamedText((current) => current + text);
          },
          onComplete: (result) => {
            setAnswer(result);
            setRequestState(
              result.answer.status === 'insufficient_evidence' ? 'insufficient' : 'complete',
            );
          },
          onCancelled: () => setRequestState('cancelled'),
          onError: (error) => {
            setRequestState('error');
            setErrorMessage(error.message);
          },
        },
      );
    },
    [_, contextPack],
  );

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
                {contextPack?.scopeLabel ?? _('Selected context is no longer available.')}
              </p>
            </section>
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
                  disabled={
                    !contextPack || requestState === 'loading' || requestState === 'streaming'
                  }
                  onClick={() => runAction(action)}
                >
                  {label}
                </button>
              ))}
              {(requestState === 'loading' || requestState === 'streaming') && (
                <button
                  type='button'
                  className='btn btn-ghost btn-sm'
                  onClick={() => requestControllerRef.current?.cancel()}
                >
                  {_('Cancel')}
                </button>
              )}
            </div>
            {(requestState === 'loading' || requestState === 'streaming') && (
              <section aria-live='polite' aria-label={_('Glossa answer')}>
                <p className='text-base-content/65 text-sm'>{_('Glossa is responding…')}</p>
                {streamedText && <p className='mt-2 text-sm leading-6'>{streamedText}</p>}
              </section>
            )}
            {requestState === 'cancelled' && (
              <p role='status' className='text-base-content/65 text-sm'>
                {_('Request cancelled.')}
              </p>
            )}
            {requestState === 'error' && (
              <p role='alert' className='text-error text-sm'>
                {errorMessage ?? _('Glossa could not complete this request.')}
              </p>
            )}
            {requestState === 'insufficient' && (
              <p role='status' className='text-base-content/65 text-sm leading-6'>
                {_(
                  'Evidence insufficient: no preceding paragraph is available in this reading context.',
                )}
              </p>
            )}
            {requestState === 'complete' && answer && (
              <section aria-label={_('Glossa answer')} className='space-y-3'>
                {answer.answer.paragraphs.map((paragraph, index) => (
                  <p key={`${paragraph.text}-${index}`} className='text-sm leading-6'>
                    {paragraph.text}
                  </p>
                ))}
                {answer.citations.length > 0 && (
                  <div className='flex flex-col items-start gap-2' aria-label={_('Sources')}>
                    {answer.citations.map((citation, index) => (
                      <button
                        key={citation.sourceId}
                        type='button'
                        className='btn btn-ghost h-auto min-h-0 max-w-full justify-start px-2 py-1 text-left text-xs'
                        aria-label={`${_('Source')} ${index + 1}`}
                        disabled={!navigator}
                        onClick={() => void navigateToCitation(citation)}
                      >
                        <span className='font-medium'>
                          {_('Source')} {index + 1}:{' '}
                        </span>
                        <span className='truncate'>
                          {Array.from(citation.text).slice(0, 140).join('')}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
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
