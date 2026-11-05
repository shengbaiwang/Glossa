import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import * as CFI from 'foliate-js/epubcfi.js';
import type { Book } from '@/types/book';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { isPluginEnabled } from '@/glossa/plugins/registry';
import { runBookMetadataRecognition } from '@/glossa/plugins/metadataRecognition';
import { loadMetadataRecognition, saveMetadataRecognition } from '@/glossa/metadata/storage';
import {
  metadataFieldValue,
  metadataPatchSchema,
  type MetadataPatch,
} from '@/glossa/metadata/confirm';
import type {
  MetadataCandidate,
  MetadataField,
  MetadataRecognition as Recognition,
} from '@/glossa/metadata/types';
import { navigateToReader } from '@/utils/nav';
import { eventDispatcher } from '@/utils/event';
import InlineTextEditor from '@/components/InlineTextEditor';

const labels: Record<MetadataField, string> = {
  title: 'Title',
  author: 'Author',
  translator: 'Translator',
  publisher: 'Publisher',
  published: 'Published',
  isbn: 'ISBN',
  language: 'Language',
  series: 'Series',
};

function SourceLink({
  book,
  source,
  fingerprint,
}: {
  book: Book;
  source: MetadataCandidate['source'];
  fingerprint: string;
}) {
  const router = useRouter();
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const [failed, setFailed] = useState(false);
  const navigation = useRef<AbortController | null>(null);
  useEffect(() => () => navigation.current?.abort(), [book.hash, fingerprint]);
  const target =
    source.pageIndex !== undefined ? CFI.fake.fromIndex(source.pageIndex) : source.href;
  return target ? (
    <>
      <button
        type='button'
        className='underline underline-offset-2'
        onClick={async () => {
          navigation.current?.abort();
          const abort = new AbortController();
          navigation.current = abort;
          try {
            const { verifyMetadataSource } = await import('@/glossa/metadata/recognize');
            const current = await verifyMetadataSource(book, envConfig, abort.signal);
            abort.signal.throwIfAborted();
            if (current !== fingerprint) throw new Error('metadata_source_changed');
            navigateToReader(router, [book.hash], new URLSearchParams({ cfi: target }).toString());
          } catch {
            if (!abort.signal.aborted) setFailed(true);
          }
        }}
      >
        {_('View source')}
      </button>
      {failed && <span role='alert'>{_('Source changed or unavailable. Recognize again.')}</span>}
    </>
  ) : null;
}

/** Candidates live beside current values; only explicit adoption writes metadata. */
export default function MetadataRecognition({
  book,
  onApply,
}: {
  book: Book;
  onApply: (expected: Book, patch: MetadataPatch) => Promise<boolean>;
}) {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { settings } = useSettingsStore();
  const enabled = isPluginEnabled(settings, 'metadataRecognition');
  const [result, setResult] = useState<Recognition | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState('');
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  const pending = useRef(false);
  const environment = useRef(envConfig);
  environment.current = envConfig;
  useEffect(() => {
    const abort = new AbortController();
    setResult(null);
    setDrafts({});
    setError('');
    const reload = () =>
      loadMetadataRecognition(book, environment.current)
        .then((cached) => {
          if (!abort.signal.aborted) setResult(cached);
        })
        .catch(() => {
          if (!abort.signal.aborted) setError('Could not read metadata candidates');
        });
    const changed = (event: CustomEvent) => {
      if (event.detail?.bookHash === book.hash && !pending.current) void reload();
    };
    if (enabled) {
      void reload();
      eventDispatcher.on('book-metadata-recognized', changed);
    }
    return () => {
      abort.abort();
      controller.current?.abort();
      eventDispatcher.off('book-metadata-recognized', changed);
    };
    // Cache identity is independent of reading progress and personal metadata.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.hash, book.contentFingerprint, book.storedContentFingerprint, enabled]);
  const run = async (expanded = false) => {
    if (pending.current) return;
    pending.current = true;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError('');
    setStage('Reading file metadata');
    try {
      const next = await runBookMetadataRecognition(book, envConfig, {
        signal: abort.signal,
        expanded,
        onStage: setStage,
      });
      if (!abort.signal.aborted) {
        setResult(next);
        setDrafts({});
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError') && !abort.signal.aborted)
        setError('Could not recognize metadata. Retry.');
    } finally {
      pending.current = false;
      setBusy(false);
      setStage('');
    }
  };
  const adopt = async (patch: MetadataPatch) => {
    if (pending.current || !result || !metadataPatchSchema.safeParse(patch).success) return;
    const expectedFingerprint = book.storedContentFingerprint || book.contentFingerprint;
    if (expectedFingerprint && result.fingerprint !== expectedFingerprint) {
      setError('Source changed or unavailable. Recognize again.');
      return;
    }
    pending.current = true;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError('');
    try {
      const { verifyMetadataSource } = await import('@/glossa/metadata/recognize');
      const fingerprint = await verifyMetadataSource(book, envConfig, abort.signal);
      abort.signal.throwIfAborted();
      if (fingerprint !== result.fingerprint) throw new Error('source_changed');
      if (!(await onApply(book, patch))) setError('Failed to save changes');
    } catch {
      if (!abort.signal.aborted) setError('Source changed or unavailable. Recognize again.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  const ignore = async (id: string) => {
    if (!result || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    const abort = new AbortController();
    controller.current = abort;
    const next = { ...result, dismissed: [...new Set([...(result.dismissed ?? []), id])] };
    try {
      await saveMetadataRecognition(book, envConfig, next, abort.signal);
      if (!abort.signal.aborted) setResult(next);
    } catch {
      if (!abort.signal.aborted) setError('Failed to save changes');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  if (!enabled) return null;
  const candidates =
    result?.candidates.filter(
      (c) => !result.dismissed?.includes(c.id) && metadataFieldValue(book, c.field) !== c.value,
    ) ?? [];
  const empty: MetadataPatch = {};
  for (const candidate of candidates) {
    if (
      candidate.field === 'title' ||
      metadataFieldValue(book, candidate.field).trim() ||
      candidate.confidence !== 'supported'
    )
      continue;
    if (candidates.filter((c) => c.field === candidate.field).length !== 1) continue;
    const value = drafts[candidate.id] ?? candidate.value;
    if (metadataPatchSchema.safeParse({ [candidate.field]: value }).success)
      empty[candidate.field] = value;
  }
  return (
    <section
      className='glossa-metadata-recognition border-base-300 mb-4 border-b pb-4'
      aria-label={_('Metadata recognition')}
    >
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <span className='text-sm font-semibold'>{_('Metadata recognition')}</span>
        {busy ? (
          <button
            type='button'
            className='btn btn-ghost btn-sm eink-bordered'
            onClick={() => controller.current?.abort()}
          >
            {_('Cancel')}
          </button>
        ) : (
          <button
            type='button'
            className='btn btn-ghost btn-sm eink-bordered'
            onClick={() => void run()}
          >
            {_(result ? 'Recognize again' : 'Recognize metadata')}
          </button>
        )}
      </div>
      {stage && (
        <p role='status' className='text-neutral-content text-sm'>
          {_(stage)}
        </p>
      )}
      {error && (
        <p role='alert' className='text-error text-sm'>
          {_(error)}
        </p>
      )}
      {result?.reason && <p className='text-neutral-content text-sm'>{_(result.reason)}</p>}
      {result && !candidates.length && (
        <p className='text-neutral-content text-sm'>{_('No pending metadata candidates')}</p>
      )}
      {candidates.map((c) => (
        <div key={c.id} className='border-base-300 mt-2 border-t pt-2 text-sm'>
          <div className='flex flex-wrap items-center justify-between gap-2'>
            <span className='font-semibold'>{_(labels[c.field])}</span>
            <span className='text-neutral-content text-xs'>
              {_(c.confidence === 'supported' ? 'Supported by source' : 'Review needed')}
            </span>
          </div>
          <p className='text-neutral-content break-words'>
            {metadataFieldValue(book, c.field) || _('Not set')}
          </p>
          <InlineTextEditor
            value={drafts[c.id] ?? c.value}
            label={`${_('Candidate')}: ${_(labels[c.field])}`}
            activateOnClick
            onSave={async (value) => {
              setDrafts((p) => ({ ...p, [c.id]: value }));
              return true;
            }}
          />
          <div className='mt-1 flex flex-wrap items-center gap-3'>
            <button
              type='button'
              disabled={
                busy ||
                !metadataPatchSchema.safeParse({ [c.field]: drafts[c.id] ?? c.value }).success
              }
              className='btn btn-ghost btn-sm eink-bordered'
              onClick={() => void adopt({ [c.field]: drafts[c.id] ?? c.value })}
            >
              {_(c.field === 'title' ? 'Use as display title' : 'Adopt')}
            </button>
            <button
              type='button'
              disabled={busy}
              className='btn btn-ghost btn-sm'
              onClick={() => void ignore(c.id)}
            >
              {_('Ignore')}
            </button>
          </div>
          <details className='mt-1'>
            <summary className='cursor-pointer text-xs'>{_('Show evidence')}</summary>
            <p className='mt-1 text-xs'>
              {_(c.source.label)}
              {c.source.pageIndex !== undefined ? ` · ${_('Page')} ${c.source.pageIndex + 1}` : ''}
            </p>
            <blockquote className='border-base-300 my-1 whitespace-pre-wrap break-words border-s-2 ps-2'>
              {c.source.excerpt}
            </blockquote>
            {c.reason && <p className='text-xs'>{_(c.reason)}</p>}
            <SourceLink book={book} source={c.source} fingerprint={result?.fingerprint ?? ''} />
          </details>
        </div>
      ))}
      {Object.keys(empty).length > 0 && (
        <button
          type='button'
          disabled={busy}
          className='btn btn-contrast btn-sm mt-3'
          onClick={() => void adopt(empty)}
        >
          {_('Fill empty fields')}
        </button>
      )}
      {result && !result.complete && (
        <button
          type='button'
          disabled={busy}
          className='btn btn-ghost btn-sm mt-3'
          onClick={() => void run(true)}
        >
          {_('Search more pages')}
        </button>
      )}
    </section>
  );
}
