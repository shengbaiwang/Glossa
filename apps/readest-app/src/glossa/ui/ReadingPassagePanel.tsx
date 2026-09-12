import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { Undo2, X } from '@/components/GlossaIcons';
import { useTranslation } from '@/hooks/useTranslation';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import type { Book } from '@/types/book';
import type { BookDoc } from '@/libs/document';
import { listChapters, extractChapter } from '@/glossa/context/chapters';
import type { ChapterDescriptor, ChapterSource } from '@/glossa/context/types';
import { resolveSource } from '@/glossa/citations/sources';
import { navigateGuideSource } from '@/glossa/citations/navigation';
import {
  getActiveProviderConfig,
  getProviderStatus,
  ModelServiceError,
  type ProviderConfig,
} from '@/glossa/ai/provider';
import { GuideError, type ReadingPassage } from '@/glossa/guide/types';
import { buildReadingPassages } from '@/glossa/guide/passages';
import type { generateReadingGuide } from '@/glossa/guide/generate';

export interface ReadingPanelProps {
  book: Book;
  bookDoc: BookDoc;
  bookKey: string;
}

export interface PassageResult {
  id: string;
  cacheKey: string;
  sources: ChapterSource[];
}
export interface ReadingPanelAdapter<T extends PassageResult> {
  id: string;
  strings?: Record<string, string>;
  directNavigation?: boolean;
  unsaved: Map<string, T>;
  generate: (options: Parameters<typeof generateReadingGuide>[0]) => Promise<T>;
  load: (bookId: string, chapterId: string, passageId: string) => Promise<T | null>;
  save: (result: T, signal?: AbortSignal) => Promise<void>;
  cacheKey: (bookId: string, passage: ReadingPassage, config: ProviderConfig) => Promise<string>;
  Document: ComponentType<{
    guide: T;
    sources: ChapterSource[];
    onSource: (source: ChapterSource) => void;
  }>;
}
type Props<T extends PassageResult> = ReadingPanelProps & { adapter: ReadingPanelAdapter<T> };

function usePanelTranslation(strings?: Record<string, string>) {
  const translate = useTranslation();
  return (key: string, options?: Record<string, string | number>) =>
    translate(strings?.[key] ?? key, options);
}

const safeError = (cause: unknown, fallback: string) =>
  cause instanceof GuideError || cause instanceof ModelServiceError ? cause.message : fallback;

export default function ReadingPassagePanel<T extends PassageResult>(props: Props<T>) {
  return (
    <ReadingGuideBook key={`${props.adapter.id}:${props.book.hash}:${props.bookKey}`} {...props} />
  );
}

function ReadingGuideBook<T extends PassageResult>(props: Props<T>) {
  const { book, bookDoc, bookKey, adapter } = props;
  const _ = usePanelTranslation(adapter.strings);
  const chapters = useMemo(
    () => (book.format === 'EPUB' ? listChapters(bookDoc) : []),
    [book.format, bookDoc],
  );
  const [chapterId, setChapterId] = useState('');
  const [config, setConfig] = useState<ProviderConfig | null>(null);
  const [providerReady, setProviderReady] = useState(false);
  const [providerError, setProviderError] = useState('');
  const chapter = chapters.find((item) => item.id === chapterId);

  useEffect(() => {
    let current = true;
    let sequence = 0;
    const refresh = async () => {
      const ticket = ++sequence;
      const next = getActiveProviderConfig();
      setConfig(next);
      setProviderReady(false);
      setProviderError('');
      if (!next) return;
      try {
        const status = await getProviderStatus(next);
        if (current && ticket === sequence) setProviderReady(status.configured);
      } catch (cause) {
        if (current && ticket === sequence)
          setProviderError(safeError(cause, 'The model service could not be checked.'));
      }
    };
    void refresh();
    window.addEventListener('glossa-model-settings-changed', refresh);
    return () => {
      current = false;
      window.removeEventListener('glossa-model-settings-changed', refresh);
    };
  }, []);

  const openModels = () => {
    const settings = useSettingsStore.getState();
    settings.setSettingsDialogBookKey(bookKey);
    settings.setRequestedPanel('Models');
    settings.setSettingsDialogOpen(true);
  };

  return (
    <div className='glossa-guide-panel' aria-label={_('Guide')}>
      {!chapter && (
        <p className='glossa-guide-intro'>
          {_(
            'Choose the passage you are reading. Start with a short guide, then unfold only what needs explaining.',
          )}
        </p>
      )}
      <label className='glossa-guide-label' htmlFor={`${bookKey}-${adapter.id}-chapter`}>
        {_('Chapter')}
      </label>
      <select
        id={`${bookKey}-${adapter.id}-chapter`}
        className='glossa-guide-select eink-bordered'
        value={chapterId}
        onChange={(event) => setChapterId(event.target.value)}
      >
        <option value=''>
          {_(chapters.length ? 'Choose a chapter' : 'No readable EPUB chapters')}
        </option>
        {chapters.map((item) => (
          <option key={item.id} value={item.id}>
            {'　'.repeat(item.depth)}
            {item.title}
          </option>
        ))}
      </select>
      {chapter && (
        <ChapterGuide
          key={chapter.id}
          {...props}
          chapter={chapter}
          config={config}
          providerReady={providerReady}
          openModels={openModels}
        />
      )}
      {providerError && (
        <p role='alert' className='glossa-guide-message'>
          {_(providerError)}
        </p>
      )}
    </div>
  );
}

interface ChapterProps<T extends PassageResult> extends ReadingPanelProps {
  adapter: ReadingPanelAdapter<T>;
  chapter: ChapterDescriptor;
  config: ProviderConfig | null;
  providerReady: boolean;
  openModels: () => void;
}

function ChapterGuide<T extends PassageResult>(props: ChapterProps<T>) {
  const { bookDoc, bookKey, chapter, adapter } = props;
  const _ = usePanelTranslation(adapter.strings);
  const [passages, setPassages] = useState<ReadingPassage[]>([]);
  const [passageId, setPassageId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const passage = passages.find((item) => item.id === passageId);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setPassages([]);
    setPassageId('');
    void extractChapter(bookDoc, chapter, { signal: controller.signal })
      .then((content) => {
        if (!controller.signal.aborted) setPassages(buildReadingPassages(content));
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(
            safeError(
              cause,
              'This chapter could not be read. Try again or choose another chapter.',
            ),
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [bookDoc, chapter, reload]);

  if (loading)
    return (
      <p role='status' className='glossa-guide-message'>
        {_('Reading chapter…')}
      </p>
    );
  if (error)
    return (
      <div role='alert' className='glossa-guide-message'>
        <p>{_(error)}</p>
        <button
          type='button'
          className='glossa-guide-text-button'
          onClick={() => setReload((value) => value + 1)}
        >
          {_('Retry reading chapter')}
        </button>
      </div>
    );
  if (!passages.length)
    return (
      <p className='glossa-guide-message'>{_('No passage text is available in this chapter.')}</p>
    );

  return (
    <div className='glossa-guide-chapter'>
      <label className='glossa-guide-label' htmlFor={`${bookKey}-${adapter.id}-passage`}>
        {_('Passage')}
      </label>
      <select
        id={`${bookKey}-${adapter.id}-passage`}
        className='glossa-guide-select eink-bordered'
        value={passageId}
        onChange={(event) => setPassageId(event.target.value)}
      >
        <option value=''>{_('Choose a passage')}</option>
        {passages.map((item) => (
          <option key={item.id} value={item.id}>
            {item.index + 1}. {item.title}
          </option>
        ))}
      </select>
      {passage && <PassageGuide key={passage.id} {...props} passage={passage} />}
    </div>
  );
}

function PassageGuide<T extends PassageResult>({
  adapter,
  book,
  bookDoc,
  bookKey,
  chapter,
  passage,
  config,
  providerReady,
  openModels,
}: ChapterProps<T> & { passage: ReadingPassage }) {
  const _ = usePanelTranslation(adapter.strings);
  const identity = JSON.stringify([book.hash, chapter.id, passage.id]);
  const unsavedGuides = adapter.unsaved;
  const ResultDocument = adapter.Document;
  const [guide, setGuide] = useState<T | null>(() => unsavedGuides.get(identity) ?? null);
  const [unsaved, setUnsaved] = useState(() => unsavedGuides.has(identity));
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [reload, setReload] = useState(0);
  const [cacheKey, setCacheKey] = useState('');
  const [busy, setBusy] = useState<'generating' | 'saving' | null>(null);
  const [received, setReceived] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [preview, setPreview] = useState<{ text: string; verified: boolean } | null>(null);
  const [sourceBusy, setSourceBusy] = useState(false);
  const [sourceError, setSourceError] = useState('');
  const [returnLocation, setReturnLocation] = useState('');
  const request = useRef<AbortController | null>(null);
  const navigation = useRef<AbortController | null>(null);
  const providerIdentity = JSON.stringify(config);

  useEffect(() => {
    request.current?.abort();
    request.current = null;
    setBusy(null);
    // A settings change must not discard an already generated, unsaved guide.
  }, [providerIdentity]);

  useEffect(
    () => () => {
      request.current?.abort();
      navigation.current?.abort();
    },
    [],
  );

  useEffect(() => {
    let current = true;
    setReady(false);
    setLoadError('');
    void adapter
      .load(book.hash, chapter.id, passage.id)
      .then((saved) => {
        if (!current) return;
        setGuide(unsavedGuides.get(identity) ?? saved);
        setUnsaved(unsavedGuides.has(identity));
        setReady(true);
      })
      .catch((cause: unknown) => {
        if (current) setLoadError(safeError(cause, 'Saved guide could not be loaded.'));
      });
    return () => {
      current = false;
    };
  }, [book.hash, chapter.id, passage.id, identity, reload, adapter, unsavedGuides]);

  useEffect(() => {
    let current = true;
    setCacheKey('');
    if (config)
      void adapter
        .cacheKey(book.hash, passage, config)
        .then((key) => {
          if (current) setCacheKey(key);
        })
        .catch(() => {
          /* Saved guides remain readable if hashing is unavailable. */
        });
    return () => {
      current = false;
    };
  }, [book.hash, passage, config, adapter]);

  const clearSource = () => {
    navigation.current?.abort();
    setPreview(null);
    setSourceBusy(false);
    setSourceError('');
  };

  const persist = async (result: T, controller: AbortController) => {
    setBusy('saving');
    setNotice('');
    try {
      await adapter.save(result, controller.signal);
      if (controller.signal.aborted) return;
      if (unsavedGuides.get(identity) === result) unsavedGuides.delete(identity);
      setUnsaved(false);
      setNotice('Guide saved on this device.');
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(safeError(cause, 'The guide could not be saved on this device.'));
    }
  };

  const generate = async () => {
    if (!ready || !config || !providerReady || busy || passage.unavailable || unsaved) return;
    clearSource();
    const controller = new AbortController();
    request.current = controller;
    setBusy('generating');
    setReceived(0);
    setError('');
    setNotice('');
    try {
      const result = await adapter.generate({
        bookId: book.hash,
        bookTitle: book.title,
        chapterTitle: chapter.title,
        chapterId: chapter.id,
        passage,
        config,
        signal: controller.signal,
        onRetry: () => {
          if (!controller.signal.aborted)
            setNotice('The response was cut short. Retrying with more room…');
        },
        onProgress: (value) => {
          if (!controller.signal.aborted) setReceived(value);
        },
      });
      if (controller.signal.aborted) return;
      setGuide(result);
      setUnsaved(true);
      unsavedGuides.set(identity, result);
      await persist(result, controller);
    } catch (cause) {
      if (!controller.signal.aborted) {
        setNotice('');
        setError(
          safeError(cause, 'Could not generate the guide. Check the model service and try again.'),
        );
      }
    } finally {
      if (request.current === controller && !controller.signal.aborted) {
        request.current = null;
        setBusy(null);
      }
    }
  };

  const retrySave = async () => {
    if (!guide || !ready || busy) return;
    const controller = new AbortController();
    request.current = controller;
    setError('');
    setNotice('');
    await persist(guide, controller);
    if (request.current === controller && !controller.signal.aborted) {
      request.current = null;
      setBusy(null);
    }
  };

  const cancel = () => {
    request.current?.abort();
    request.current = null;
    setBusy(null);
    setNotice(busy === 'saving' ? 'Saving cancelled.' : 'Generation cancelled.');
  };

  const showSource = async (source: ChapterSource) => {
    navigation.current?.abort();
    const controller = new AbortController();
    navigation.current = controller;
    setPreview(adapter.directNavigation ? null : { text: source.text, verified: false });
    setSourceBusy(true);
    setSourceError('');
    try {
      const resolved = await resolveSource(bookDoc, source, { signal: controller.signal });
      if (controller.signal.aborted) return;
      const reader = useReaderStore.getState();
      const view = reader.getView(bookKey);
      if (!resolved || !view) throw new Error('unresolved');
      const origin = reader.getProgress(bookKey)?.location;
      // Foliate may finish goTo after cancellation, so retain the return point before moving.
      if (origin) setReturnLocation((previous) => previous || origin);
      await navigateGuideSource(view, resolved.cfi, controller.signal);
      if (controller.signal.aborted) return;
      if (!adapter.directNavigation) setPreview({ text: resolved.text, verified: true });
    } catch {
      if (!controller.signal.aborted) {
        setPreview({ text: source.text, verified: false });
        setSourceError(
          'The source location could not be verified. The saved excerpt is shown below.',
        );
      }
    } finally {
      if (!controller.signal.aborted) setSourceBusy(false);
    }
  };

  const goBack = async () => {
    navigation.current?.abort();
    const controller = new AbortController();
    navigation.current = controller;
    setSourceBusy(true);
    setSourceError('');
    try {
      const view = useReaderStore.getState().getView(bookKey);
      if (!view) throw new Error('missing view');
      await navigateGuideSource(view, returnLocation, controller.signal);
      if (!controller.signal.aborted) setReturnLocation('');
    } catch {
      if (!controller.signal.aborted)
        setSourceError('Could not return to the previous reading position.');
    } finally {
      if (!controller.signal.aborted) setSourceBusy(false);
    }
  };

  const first = passage.sources[0]?.text ?? '';
  const last = passage.sources[passage.sources.length - 1]?.text ?? '';
  const rangeAndActions = (
    <>
      <details className='glossa-guide-range' open={!guide}>
        <summary>
          {_('Passage {{number}} · {{count}} characters', {
            number: passage.index + 1,
            count: passage.characterCount.toLocaleString(),
          })}
        </summary>
        <p>
          {_('Starts: {{text}}', { text: first.length > 72 ? `${first.slice(0, 72)}…` : first })}
        </p>
        <p>{_('Ends: {{text}}', { text: last.length > 72 ? `…${last.slice(-72)}` : last })}</p>
      </details>
      {passage.unavailable ? (
        <p className='glossa-guide-message'>
          {_('This passage is too long to guide safely. Choose another passage.')}
        </p>
      ) : (
        <div className='glossa-guide-actions'>
          <button
            type='button'
            className='glossa-guide-text-button glossa-guide-model'
            onClick={openModels}
            title={_('Model Services')}
          >
            {config && providerReady
              ? `${config.name} · ${config.model}`
              : _('Configure model service')}
          </button>
          {config && (
            <p className='glossa-guide-message'>
              {_('Only this passage will be sent to {{provider}}.', { provider: config.name })}
            </p>
          )}

          <button
            type='button'
            className='glossa-button glossa-button-primary btn-contrast glossa-guide-generate'
            disabled={!ready || !providerReady || busy !== null || unsaved}
            onClick={() => void generate()}
          >
            {_(guide ? 'Regenerate guide' : 'Generate guide')}
          </button>
        </div>
      )}
    </>
  );
  return (
    <div className='glossa-guide-passage'>
      {adapter.directNavigation && guide ? (
        <details className='glossa-map-options'>
          <summary>{_('Passage and model')}</summary>
          {rangeAndActions}
        </details>
      ) : (
        rangeAndActions
      )}
      {!ready && !loadError && (
        <p role='status' className='glossa-guide-message'>
          {_('Loading saved guide…')}
        </p>
      )}
      {loadError && (
        <div role='alert' className='glossa-guide-message'>
          <p>{_(loadError)}</p>
          <button
            type='button'
            className='glossa-guide-text-button'
            onClick={() => setReload((value) => value + 1)}
          >
            {_('Retry loading guide')}
          </button>
        </div>
      )}
      {busy && (
        <div role='status' className='glossa-guide-status'>
          <span>
            {_(busy === 'saving' ? 'Saving…' : received ? 'Writing guide…' : 'Preparing guide…')}
          </span>
          <button type='button' className='glossa-guide-text-button' onClick={cancel}>
            {_('Cancel')}
          </button>
        </div>
      )}
      {error && (
        <p role='alert' className='glossa-guide-message'>
          {_(error)}
        </p>
      )}
      {notice && (
        <p
          role='status'
          className={
            adapter.directNavigation && notice === 'Guide saved on this device.'
              ? 'sr-only'
              : 'glossa-guide-message'
          }
        >
          {_(notice)}
        </p>
      )}
      {unsaved && !busy && (
        <div className='glossa-guide-message'>
          <p>{_('This guide has not been saved yet.')}</p>
          <button
            type='button'
            className='glossa-guide-text-button'
            disabled={!ready}
            onClick={() => void retrySave()}
          >
            {_('Retry saving guide')}
          </button>
        </div>
      )}
      {guide && cacheKey && guide.cacheKey !== cacheKey && (
        <p className='glossa-guide-message'>
          {_('This saved guide uses earlier text or model settings.')}
        </p>
      )}
      {guide && (
        <ResultDocument
          key={guide.id}
          guide={guide}
          sources={guide.sources}
          onSource={(source) => void showSource(source)}
        />
      )}
      {returnLocation && (
        <button
          type='button'
          className='glossa-guide-text-button'
          disabled={sourceBusy}
          onClick={() => void goBack()}
        >
          <Undo2 size={16} aria-hidden='true' />
          {_('Return to reading position')}
        </button>
      )}
      {sourceError && (
        <p role='alert' className='glossa-guide-message'>
          {_(sourceError)}
        </p>
      )}
      {preview && (
        <aside className='glossa-guide-source eink-bordered' aria-label={_('Source excerpt')}>
          <div className='glossa-guide-status'>
            <span role='status'>
              {_(
                sourceBusy
                  ? 'Verifying source…'
                  : preview.verified
                    ? 'Verified in this book'
                    : 'Saved excerpt · unverified',
              )}
            </span>
            <button
              type='button'
              className='glossa-guide-text-button'
              aria-label={_('Close source excerpt')}
              onClick={clearSource}
            >
              <X size={16} aria-hidden='true' />
            </button>
          </div>
          <blockquote className='select-text' dir='auto'>
            {preview.text}
          </blockquote>
        </aside>
      )}
    </div>
  );
}
