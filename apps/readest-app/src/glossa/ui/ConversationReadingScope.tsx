import { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, ChevronDown, X } from '@/components/GlossaIcons';
import { useTranslation } from '@/hooks/useTranslation';
import { useReaderStore } from '@/store/readerStore';
import type { BookDoc } from '@/libs/document';
import { listChapters } from '@/glossa/context/chapters';
import type { ReadingPassage } from '@/glossa/passages/types';
import type { ReadingScope } from '@/glossa/harness/scope';
import { MAX_READING_SOURCE_CHARS, ReadingScopeError } from '@/glossa/harness/scope';
import {
  captureReadingScope,
  prepareChapterPassages,
  scopeForPassage,
} from '@/glossa/harness/epub';

export default function ConversationReadingScope({
  bookDoc,
  bookKey,
  documentHash,
  value,
  disabled,
  onChange,
  onBusyChange,
}: {
  bookDoc: BookDoc;
  bookKey: string;
  documentHash: string;
  value?: ReadingScope;
  disabled: boolean;
  onChange: (scope?: ReadingScope) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const _ = useTranslation();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [chapterId, setChapterId] = useState('');
  const [passages, setPassages] = useState<ReadingPassage[]>([]);
  const [passageId, setPassageId] = useState('');
  const request = useRef<AbortController | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const chapters = useMemo(
    () => (open && bookDoc.sections?.length ? listChapters(bookDoc) : []),
    [open, bookDoc],
  );
  const chapter = chapters.find((item) => item.id === chapterId);
  const passage = passages.find((item) => item.id === passageId);
  const cancel = () => {
    request.current?.abort();
    request.current = null;
    setBusy(false);
    onBusyChange(false);
  };
  useEffect(
    () => () => {
      request.current?.abort();
      onBusyChange(false);
    },
    [],
  );
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) {
        cancel();
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  const attach = (scope: ReadingScope) => {
    onChange(scope);
    setOpen(false);
    setError('');
  };
  const capture = async (kind: 'page' | 'selection' | 'auto') => {
    cancel();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    onBusyChange(true);
    setOpen(true);
    setError('');
    try {
      const view = useReaderStore.getState().getView(bookKey);
      if (!view) throw new Error();
      const scope = await captureReadingScope({
        bookDoc,
        view,
        documentHash,
        kind,
        signal: controller.signal,
      });
      if (
        scope.sources.reduce((total, source) => total + source.text.length, 0) >
        MAX_READING_SOURCE_CHARS
      )
        throw new ReadingScopeError('Choose a shorter reading passage.');
      if (!controller.signal.aborted) attach(scope);
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(
          cause instanceof ReadingScopeError
            ? cause.message
            : kind === 'selection'
              ? 'Select text in the book first.'
              : 'The current page could not be read. Try again.',
        );
    } finally {
      if (request.current === controller) cancel();
    }
  };
  const chooseChapter = async (id: string) => {
    cancel();
    setChapterId(id);
    setPassages([]);
    setPassageId('');
    setError('');
    const chosen = chapters.find((item) => item.id === id);
    if (!chosen) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    onBusyChange(true);
    try {
      const items = await prepareChapterPassages({
        bookDoc,
        chapter: chosen,
        signal: controller.signal,
      });
      if (!controller.signal.aborted) {
        setPassages(items);
        if (!items.length) setError('No passage text is available in this chapter.');
      }
    } catch {
      if (!controller.signal.aborted)
        setError('This chapter could not be read. Try again or choose another chapter.');
    } finally {
      if (request.current === controller) cancel();
    }
  };
  return (
    <div
      className='glossa-chat-reading'
      ref={root}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.preventDefault();
          cancel();
          setOpen(false);
          root.current?.querySelector<HTMLButtonElement>('button')?.focus();
        }
      }}
    >
      <div className='glossa-chat-reading-label'>
        <button
          type='button'
          className='glossa-chat-text-button'
          disabled={disabled || busy}
          aria-expanded={value ? open : undefined}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => {
            if (value) {
              setOpen(!open);
              setError('');
            } else {
              void capture('auto');
            }
          }}
        >
          <BookOpen size={15} />
          <span>{value ? _(value.title) : _('Use book text')}</span>
        </button>
        <button
          type='button'
          className='glossa-chat-text-button'
          disabled={disabled || busy}
          aria-label={_('Choose reading range')}
          title={_('Choose reading range')}
          aria-expanded={open}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => {
            setOpen(!open);
            setError('');
          }}
        >
          <ChevronDown size={14} />
        </button>
        {value && (
          <button
            type='button'
            className='glossa-chat-text-button'
            disabled={disabled}
            aria-label={_('Remove reading source')}
            title={_('Remove reading source')}
            onClick={() => {
              cancel();
              onChange(undefined);
              setOpen(false);
            }}
          >
            <X size={14} />
          </button>
        )}
      </div>
      {open && (
        <div className='glossa-chat-reading-options eink-bordered'>
          {value && (
            <details open>
              <summary>{_('Attached text')}</summary>
              <div className='glossa-chat-reading-preview' dir='auto'>
                {value.sources.map((source) => (
                  <p key={source.sourceId}>{source.text}</p>
                ))}
              </div>
            </details>
          )}
          <div className='glossa-chat-reading-actions'>
            <button
              type='button'
              className='glossa-chat-text-button'
              disabled={busy || disabled}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => void capture('page')}
            >
              {_('Use current page')}
            </button>
            <button
              type='button'
              className='glossa-chat-text-button'
              disabled={busy || disabled}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => void capture('selection')}
            >
              {_('Use selected text')}
            </button>
          </div>
          <select
            aria-label={_('Choose a chapter')}
            className='glossa-passage-select eink-bordered'
            value={chapterId}
            disabled={disabled}
            onChange={(event) => void chooseChapter(event.target.value)}
          >
            <option value=''>{_('Choose a chapter')}</option>
            {chapters.map((item) => (
              <option key={item.id} value={item.id}>
                {'　'.repeat(item.depth)}
                {item.title}
              </option>
            ))}
          </select>
          {passages.length > 0 && (
            <>
              <select
                aria-label={_('Choose a passage')}
                className='glossa-passage-select eink-bordered'
                value={passageId}
                disabled={disabled || busy}
                onChange={(event) => setPassageId(event.target.value)}
              >
                <option value=''>{_('Choose a passage')}</option>
                {passages.map((item) => (
                  <option key={item.id} value={item.id} disabled={item.unavailable}>
                    {item.index + 1}. {item.title}
                  </option>
                ))}
              </select>
              {passage && (
                <>
                  <div className='glossa-chat-reading-preview' dir='auto'>
                    {passage.sources.map((source) => (
                      <p key={source.sourceId}>{source.text}</p>
                    ))}
                  </div>
                  <button
                    type='button'
                    className='glossa-chat-text-button'
                    disabled={disabled || busy || passage.unavailable}
                    onClick={() => {
                      if (chapter) attach(scopeForPassage(documentHash, chapter, passage));
                    }}
                  >
                    {_('Use this passage')}
                  </button>
                </>
              )}
            </>
          )}
          {busy && (
            <div role='status' className='glossa-chat-reading-actions'>
              {_('Reading text…')}
              <button type='button' className='glossa-chat-text-button' onClick={cancel}>
                {_('Cancel')}
              </button>
            </div>
          )}
          {error && <p role='alert'>{_(error)}</p>}
        </div>
      )}
    </div>
  );
}
