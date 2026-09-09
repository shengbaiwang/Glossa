import { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, NotebookPen, Undo2, X } from '@/components/GlossaIcons';
import { useTranslation } from '@/hooks/useTranslation';
import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useReaderStore } from '@/store/readerStore';
import type { Book } from '@/types/book';
import type { BookDoc } from '@/libs/document';
import { listChapters, extractChapter } from '@/glossa/context/chapters';
import type { ChapterContent, ChapterSource } from '@/glossa/context/types';
import { resolveSource } from '@/glossa/citations/sources';
import { getActiveProviderConfig, getProviderStatus } from '@/glossa/ai/provider';
import type { ProviderConfig } from '@/glossa/ai/provider';
import { generateStudyNote, getStudyNoteCacheKey } from '@/glossa/notes/generate';
import { loadChapterNotes, savePersonalNote } from '@/glossa/notes/store';
import { exportStudyNoteMarkdown } from '@/glossa/notes/export';
import type { StudyNoteBody, StudyNoteVersion } from '@/glossa/notes/types';
import StudyNoteDocument from './StudyNoteDocument';

interface Props {
  book: Book;
  bookDoc: BookDoc;
  bookKey: string;
}

// Retain a failed edit across sidebar unmounts until it has actually reached local storage.
const reflectionDrafts = new Map<string, { text: string }>();

export default function StudyNotesPanel({ book, bookDoc, bookKey }: Props) {
  const _ = useTranslation();
  const { appService } = useEnv();
  const chapters = useMemo(() => listChapters(bookDoc), [bookDoc]);
  const [chapterId, setChapterId] = useState(() => {
    const href = useReaderStore.getState().getProgress(bookKey)?.sectionHref;
    return (chapters.find((chapter) => chapter.href === href) ?? chapters[0])?.id ?? '';
  });
  const chapter = chapters.find((item) => item.id === chapterId);
  const reflectionKey = JSON.stringify([book.hash, chapterId]);
  const [content, setContent] = useState<ChapterContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyReady, setHistoryReady] = useState(false);
  const [reload, setReload] = useState(0);
  const [versions, setVersions] = useState<StudyNoteVersion[]>([]);
  const [versionId, setVersionId] = useState('');
  const [personalNote, setPersonalNote] = useState('');
  const [personalStatus, setPersonalStatus] = useState<'saved' | 'saving' | 'error'>('saved');
  const personalRevision = useRef(0);
  const [config, setConfig] = useState<ProviderConfig | null>(null);
  const [providerReady, setProviderReady] = useState(false);
  const [cacheKey, setCacheKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [partial, setPartial] = useState<StudyNoteBody | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [sourcePreview, setSourcePreview] = useState<{
    source: ChapterSource;
    text: string;
    verified: boolean;
  } | null>(null);
  const [sourceBusy, setSourceBusy] = useState(false);
  const [returnLocation, setReturnLocation] = useState('');
  const generation = useRef<AbortController | null>(null);
  const navigation = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const version = versions.find((item) => item.id === versionId) ?? versions[0];

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current?.abort();
      navigation.current?.abort();
    };
  }, []);

  useEffect(() => {
    let current = true;
    let sequence = 0;
    const refresh = async () => {
      const request = ++sequence;
      const next = getActiveProviderConfig();
      setConfig(next);
      setProviderReady(false);
      if (!next) return;
      try {
        const status = await getProviderStatus(next);
        if (current && request === sequence) setProviderReady(status.configured);
      } catch {
        if (current && request === sequence) setProviderReady(false);
      }
    };
    void refresh();
    window.addEventListener('glossa-model-settings-changed', refresh);
    return () => {
      current = false;
      window.removeEventListener('glossa-model-settings-changed', refresh);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    generation.current?.abort();
    generation.current = null;
    navigation.current?.abort();
    personalRevision.current += 1;
    setBusy(false);
    setContent(null);
    setVersions([]);
    setVersionId('');
    setPersonalNote('');
    setPersonalStatus('saved');
    setSourcePreview(null);
    setReturnLocation('');
    setPartial(null);
    setError('');
    setNotice('');
    setLoading(true);
    setHistoryLoading(true);
    setHistoryReady(false);
    if (!chapter) {
      setLoading(false);
      setHistoryLoading(false);
      return () => controller.abort();
    }
    void extractChapter(bookDoc, chapter, { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setContent(result);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError('This chapter could not be read. Try another chapter.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    void loadChapterNotes(book.hash, chapter.id)
      .then((result) => {
        if (controller.signal.aborted) return;
        setVersions(result.versions);
        setVersionId(result.versions[0]?.id ?? '');
        const draft = reflectionDrafts.get(reflectionKey);
        setPersonalNote(draft?.text ?? result.personalNote);
        setPersonalStatus(draft ? 'error' : 'saved');
        setHistoryReady(true);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError('Saved study notes could not be loaded.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setHistoryLoading(false);
      });
    return () => controller.abort();
  }, [book.hash, bookDoc, chapter, reflectionKey, reload]);

  useEffect(() => {
    let current = true;
    setCacheKey('');
    if (content && config) {
      void getStudyNoteCacheKey(book.hash, content, config)
        .then((key) => {
          if (current) setCacheKey(key);
        })
        .catch(() => {
          /* Notes remain readable if hashing is unavailable. */
        });
    }
    return () => {
      current = false;
    };
  }, [book.hash, content, config]);

  const openModels = () => {
    const settings = useSettingsStore.getState();
    settings.setSettingsDialogBookKey(bookKey);
    settings.setRequestedPanel('Models');
    settings.setSettingsDialogOpen(true);
  };

  const generate = async () => {
    if (!content || !config || !providerReady || busy) return;
    const controller = new AbortController();
    generation.current = controller;
    setBusy(true);
    setPartial(null);
    setError('');
    setNotice('');
    setProgress({ completed: 0, total: 0 });
    try {
      const result = await generateStudyNote({
        bookId: book.hash,
        bookTitle: book.title,
        content,
        config,
        signal: controller.signal,
        onProgress: (value) => {
          if (!controller.signal.aborted) setProgress(value);
        },
        onPartial: (value) => {
          if (!controller.signal.aborted) setPartial(value);
        },
      });
      if (!mounted.current || controller.signal.aborted) return;
      setVersions((previous) => [result, ...previous]);
      setVersionId(result.id);
      setNotice('Study note saved on this device.');
    } catch (cause) {
      if (!mounted.current || generation.current !== controller) return;
      if (controller.signal.aborted) setNotice('Generation cancelled. Previous notes are kept.');
      else
        setError(
          cause instanceof Error && cause.name === 'NotesError'
            ? cause.message
            : 'Could not generate the study note. Check the model service and try again.',
        );
    } finally {
      if (mounted.current && generation.current === controller) {
        generation.current = null;
        setBusy(false);
        setPartial(null);
      }
    }
  };

  const savePersonal = async (text: string) => {
    if (!chapter) return;
    setPersonalNote(text);
    setPersonalStatus('saving');
    const draft = { text };
    reflectionDrafts.set(reflectionKey, draft);
    const revision = ++personalRevision.current;
    try {
      await savePersonalNote(book.hash, chapter.id, text);
      if (reflectionDrafts.get(reflectionKey) === draft) reflectionDrafts.delete(reflectionKey);
      if (mounted.current && revision === personalRevision.current) setPersonalStatus('saved');
    } catch {
      if (mounted.current && revision === personalRevision.current) setPersonalStatus('error');
    }
  };

  const showSource = async (source: ChapterSource) => {
    navigation.current?.abort();
    const controller = new AbortController();
    navigation.current = controller;
    setSourceBusy(true);
    setSourcePreview({ source, text: source.text, verified: false });
    setError('');
    try {
      const resolved = await resolveSource(bookDoc, source, { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (!resolved) throw new Error('unresolved');
      const reader = useReaderStore.getState();
      const view = reader.getView(bookKey);
      if (!view) throw new Error('missing view');
      const origin = reader.getProgress(bookKey)?.location;
      await view.goTo(resolved.cfi);
      if (controller.signal.aborted) return;
      if (!returnLocation && origin) setReturnLocation(origin);
      setSourcePreview({ source, text: resolved.text, verified: true });
    } catch {
      if (!controller.signal.aborted)
        setError('The source location could not be verified. The saved excerpt is shown below.');
    } finally {
      if (!controller.signal.aborted) setSourceBusy(false);
    }
  };

  const goBack = async () => {
    try {
      const view = useReaderStore.getState().getView(bookKey);
      if (!view) throw new Error('missing view');
      await view.goTo(returnLocation);
      setReturnLocation('');
    } catch {
      setError('Could not return to the previous reading position.');
    }
  };

  const exportNote = async () => {
    if (!version || !appService) return;
    try {
      const filename = `${book.title} - ${version.chapterTitle}`
        .replace(/[\\/:*?"<>|]/g, '_')
        .slice(0, 160);
      const saved = await appService.saveFile(
        `${filename}.md`,
        exportStudyNoteMarkdown(version, personalNote),
        { mimeType: 'text/markdown' },
      );
      if (saved) setNotice('Study note exported.');
    } catch {
      setError('The study note could not be exported.');
    }
  };

  const displayedNote = busy && partial ? partial : version;
  const displayedSources = busy && partial ? (content?.sources ?? []) : (version?.sources ?? []);

  return (
    <div className='glossa-study-panel space-y-5 px-4 pb-8 pt-3' aria-label={_('Study notes')}>
      <div className='flex items-center justify-between gap-2'>
        <h2 className='flex items-center gap-2 text-sm font-semibold'>
          <NotebookPen size={17} />
          {_('Study notes')}
        </h2>
        <button
          type='button'
          className='glossa-study-text-button max-w-[55%] truncate'
          onClick={openModels}
          title={_('Model Services')}
        >
          {config ? config.model || config.name : _('Set up a model')}
        </button>
      </div>
      <div className='space-y-2'>
        <label className='glossa-study-label' htmlFor={`${bookKey}-study-chapter`}>
          {_('Chapter')}
        </label>
        <select
          id={`${bookKey}-study-chapter`}
          className='glossa-study-input eink-bordered w-full'
          value={chapterId}
          disabled={busy || personalStatus !== 'saved'}
          onChange={(event) => setChapterId(event.target.value)}
        >
          {chapters.length === 0 && <option value=''>{_('No readable chapters')}</option>}
          {chapters.map((item) => (
            <option key={item.id} value={item.id}>
              {'　'.repeat(item.depth)}
              {item.title}
            </option>
          ))}
        </select>
        <p className='glossa-study-muted text-xs leading-relaxed'>
          {loading
            ? _('Reading chapter…')
            : content
              ? _('{{count}} characters · only this chapter', {
                  count: content.characterCount.toLocaleString(),
                })
              : _('No chapter text available.')}
        </p>
      </div>
      {!providerReady && (
        <div className='glossa-study-callout space-y-3'>
          <p className='text-sm leading-relaxed'>
            {_('Connect a model to turn this chapter into a study note with sources.')}
          </p>
          <button type='button' className='glossa-button eink-bordered w-full' onClick={openModels}>
            {_('Configure model service')}
          </button>
        </div>
      )}
      {providerReady && (
        <div className='space-y-2'>
          <button
            type='button'
            className='glossa-button glossa-button-primary btn-contrast w-full'
            disabled={loading || !historyReady || !content?.sources.length || busy}
            onClick={() => void generate()}
          >
            <BookOpen size={16} />
            {version ? _('Generate a new version') : _('Generate study note')}
          </button>
          <p className='glossa-study-muted text-xs leading-relaxed'>
            {_(
              'The selected chapter, including its subsections, will be sent to {{provider}} when you generate.',
              { provider: config?.name ?? '' },
            )}
          </p>
        </div>
      )}
      {busy && (
        <div className='glossa-study-callout space-y-2' role='status' aria-live='polite'>
          <div className='flex items-center justify-between gap-2'>
            <span className='text-sm'>
              {progress.total > 0
                ? _('Writing notes · {{completed}} / {{total}} parts', progress)
                : _('Preparing study note…')}
            </span>
            <button
              type='button'
              className='glossa-study-text-button'
              onClick={() => generation.current?.abort()}
            >
              {_('Cancel')}
            </button>
          </div>
          <progress
            className='glossa-study-progress w-full'
            value={progress.completed}
            max={progress.total || 1}
            aria-label={_('Study note progress')}
          />
          <p className='glossa-study-muted text-xs'>
            {_('Closing this panel cancels generation.')}
          </p>
        </div>
      )}
      {error && (
        <p role='alert' className='glossa-study-callout text-sm leading-relaxed'>
          {_(error)}
        </p>
      )}
      {!loading && !historyLoading && (!historyReady || !content) && (
        <button
          type='button'
          className='glossa-study-text-button'
          onClick={() => setReload((value) => value + 1)}
        >
          {_('Reload chapter notes')}
        </button>
      )}
      {notice && (
        <p role='status' className='glossa-study-muted text-xs'>
          {_(notice)}
        </p>
      )}
      {sourcePreview && (
        <aside className='glossa-study-source select-text' aria-label={_('Source excerpt')}>
          <div className='mb-2 flex items-center justify-between gap-2'>
            <span className='glossa-study-label'>
              {sourceBusy
                ? _('Locating source…')
                : sourcePreview.verified
                  ? _('Original source')
                  : _('Saved excerpt')}
            </span>
            <button
              type='button'
              className='glossa-icon-button'
              aria-label={_('Close source excerpt')}
              onClick={() => {
                navigation.current?.abort();
                setSourcePreview(null);
              }}
            >
              <X size={14} />
            </button>
          </div>
          <blockquote>{sourcePreview.text}</blockquote>
          {returnLocation && (
            <button
              type='button'
              className='glossa-study-text-button mt-3 inline-flex items-center gap-1'
              onClick={() => void goBack()}
            >
              <Undo2 size={14} />
              {_('Return to reading position')}
            </button>
          )}
        </aside>
      )}
      {historyLoading && (
        <p className='glossa-study-muted text-sm' role='status'>
          {_('Loading saved notes…')}
        </p>
      )}
      {version && !busy && (
        <div className='space-y-2'>
          <div className='flex items-center justify-between gap-2'>
            <label className='glossa-study-label' htmlFor={`${bookKey}-study-version`}>
              {_('Saved versions')}
            </label>
            <button
              type='button'
              className='glossa-study-text-button'
              onClick={() => void exportNote()}
            >
              {_('Export Markdown')}
            </button>
          </div>
          <select
            className='glossa-study-input w-full'
            id={`${bookKey}-study-version`}
            value={version.id}
            onChange={(event) => {
              navigation.current?.abort();
              setSourceBusy(false);
              setVersionId(event.target.value);
              setSourcePreview(null);
            }}
          >
            {versions.map((item) => (
              <option key={item.id} value={item.id}>
                {new Date(item.createdAt).toLocaleString()} · {item.provider.model}
              </option>
            ))}
          </select>
          {cacheKey && cacheKey !== version.cacheKey && (
            <p className='glossa-study-muted text-xs'>
              {_(
                'This version uses different chapter content or model settings. It remains available below.',
              )}
            </p>
          )}
        </div>
      )}
      {displayedNote ? (
        <StudyNoteDocument
          note={displayedNote}
          sources={displayedSources}
          onSource={(source) => void showSource(source)}
        />
      ) : (
        !busy &&
        !historyLoading && (
          <div className='glossa-study-empty space-y-3 py-5'>
            <BookOpen size={28} />
            <p className='text-sm font-medium'>{_('Read a chapter. Keep the understanding.')}</p>
            <p className='glossa-study-muted text-sm leading-relaxed'>
              {_(
                'Follow the main argument, preserve examples and limits, then test your understanding. Each point leads back to the text.',
              )}
            </p>
          </div>
        )
      )}
      {chapter && historyReady && (
        <section className='glossa-study-personal space-y-2'>
          <label className='glossa-study-label' htmlFor={`${bookKey}-study-personal`}>
            {_('My reflections')}
          </label>
          <textarea
            className='glossa-study-input eink-bordered min-h-28 w-full resize-y select-text'
            id={`${bookKey}-study-personal`}
            rows={4}
            value={personalNote}
            placeholder={_('Questions, connections, and thoughts in your own words…')}
            onChange={(event) => void savePersonal(event.target.value)}
          />
          <div className='glossa-study-muted text-xs' role='status'>
            {personalStatus === 'saving' ? (
              _('Saving…')
            ) : personalStatus === 'error' ? (
              <>
                {_('Your reflection could not be saved.')}{' '}
                <button
                  type='button'
                  className='glossa-study-text-button'
                  onClick={() => void savePersonal(personalNote)}
                >
                  {_('Retry')}
                </button>
              </>
            ) : (
              _('Saved locally · your reflections are never sent to the model')
            )}
          </div>
        </section>
      )}
    </div>
  );
}
