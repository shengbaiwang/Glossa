import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import {
  getActiveProviderConfig,
  getProviderStatus,
  MODEL_SETTINGS_EVENT,
  ModelServiceError,
  type ProviderConfig,
} from '@/glossa/ai/provider';
import { createEpubBookAccess } from '@/glossa/harness/epub';
import { expandMapNode, generateOverviewMap, type MapProgress } from '@/glossa/mindmap/explore';
import { getMapCheckpointKey, mapCheckpointStore } from '@/glossa/mindmap/checkpoints';
import type { LocalMap } from '@/glossa/mindmap/workspace';
import type { ReadingMindmap } from '@/glossa/mindmap/types';
import { PassageError } from '@/glossa/passages/types';
import type { ReadingPanelProps } from './ReadingPassagePanel';
import GeneratedMindmapPanel from './GeneratedMindmapPanel';
import ConversationModelPicker from './ConversationModelPicker';

const errorText = (error: unknown) =>
  error instanceof PassageError || error instanceof ModelServiceError
    ? error.message
    : 'The model service could not generate this mind map. Try again.';

function useMapGeneration(bookKey: string) {
  const [config, setConfig] = useState<ProviderConfig | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  const cancel = () => {
    request.current?.abort();
    setBusy(false);
    setError('');
  };
  useEffect(() => {
    let alive = true,
      revision = 0;
    const refresh = async () => {
      const ticket = ++revision;
      cancel();
      const next = getActiveProviderConfig();
      setConfig(next);
      setReady(false);
      setError('');
      if (!next) return;
      try {
        const status = await getProviderStatus(next);
        if (alive && ticket === revision) setReady(status.configured);
      } catch (cause) {
        if (alive && ticket === revision) setError(errorText(cause));
      }
    };
    void refresh();
    window.addEventListener(MODEL_SETTINGS_EVENT, refresh);
    return () => {
      alive = false;
      request.current?.abort();
      window.removeEventListener(MODEL_SETTINGS_EVENT, refresh);
    };
  }, []);
  const run = async (work: (config: ProviderConfig, signal: AbortSignal) => Promise<void>) => {
    if (!config || !ready || busy) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError('');
    try {
      await work(config, controller.signal);
    } catch (cause) {
      if (!controller.signal.aborted) setError(errorText(cause));
    } finally {
      if (request.current === controller && !controller.signal.aborted) setBusy(false);
    }
  };
  const openSettings = () => {
    const settings = useSettingsStore.getState();
    settings.setSettingsDialogBookKey(bookKey);
    settings.setRequestedPanel('Models');
    settings.setSettingsDialogOpen(true);
  };
  return { config, ready, busy, error, run, cancel, openSettings };
}

export default function MindmapGeneration(
  props: ReadingPanelProps & { onUseMap: (map: ReadingMindmap) => void },
) {
  const _ = useTranslation();
  const [kind, setKind] = useState<'chapter' | 'book' | 'passage'>('chapter');
  return (
    <div className='glossa-map-generation-form'>
      <label className='glossa-passage-label'>
        {_('Map range')}
        <select
          aria-label={_('Map range')}
          className='glossa-passage-select eink-bordered'
          value={kind}
          onChange={(event) => setKind(event.target.value as typeof kind)}
        >
          <option value='chapter'>{_('Whole chapter')}</option>
          <option value='book'>{_('Whole book')}</option>
          <option value='passage'>{_('Reading passage')}</option>
        </select>
      </label>
      {kind === 'passage' ? (
        <GeneratedMindmapPanel {...props} />
      ) : (
        <OverviewForm key={kind} {...props} kind={kind} />
      )}
    </div>
  );
}

function OverviewForm(
  props: ReadingPanelProps & { kind: 'chapter' | 'book'; onUseMap: (map: ReadingMindmap) => void },
) {
  const _ = useTranslation();
  const model = useMapGeneration(props.bookKey);
  const access = useMemo(() => {
    try {
      return props.book.format === 'EPUB'
        ? createEpubBookAccess(props.bookDoc, props.book.hash)
        : null;
    } catch {
      return null;
    }
  }, [props.bookDoc, props.book.hash, props.book.format]);
  const [chapterId, setChapterId] = useState('');
  const [progress, setProgress] = useState<MapProgress | null>(null);
  const [checking, setChecking] = useState(true);
  const [resumeError, setResumeError] = useState('');
  const [result, setResult] = useState<ReadingMindmap | null>(null);
  const chapter = access?.chapters.find((c) => c.id === chapterId);
  const title = (props.kind === 'chapter' ? chapter?.title : props.book.title) || 'Mind map';
  useEffect(() => {
    let alive = true;
    if (model.busy) return;
    setChecking(true);
    setResumeError('');
    const read = async () => {
      if (!model.config || (props.kind === 'chapter' && !chapterId)) {
        setProgress(null);
        setChecking(false);
        return;
      }
      try {
        const key = await getMapCheckpointKey({
          bookId: props.book.hash,
          title,
          target: props.kind === 'book' ? { kind: 'book' } : { kind: 'chapter', chapterId },
          config: model.config,
        });
        const { checkpoint } = await mapCheckpointStore.load(key);
        if (alive)
          setProgress(
            checkpoint
              ? {
                  phase: checkpoint.result ? 'ready' : 'inventory',
                  completed: checkpoint.batches.filter((batch) => batch.points !== undefined)
                    .length,
                  total: checkpoint.batches.length,
                  elapsedMs: 0,
                }
              : null,
          );
      } catch (error) {
        if (alive) {
          setProgress(null);
          setResumeError(errorText(error));
        }
      } finally {
        if (alive) setChecking(false);
      }
    };
    void read();
    return () => {
      alive = false;
    };
  }, [model.config, model.busy, props.book.hash, props.kind, chapterId, title]);
  useEffect(() => {
    setResult(null);
  }, [model.config, props.book.hash, chapterId]);
  const generate = (restart = false) =>
    model.run(async (config, signal) => {
      if (!access) return;
      setResult(null);
      setProgress({ phase: 'reading', completed: 0, total: 0, elapsedMs: 0 });
      const generated = await generateOverviewMap({
        bookId: props.book.hash,
        title,
        target: props.kind === 'book' ? { kind: 'book' } : { kind: 'chapter', chapterId },
        access,
        config,
        signal,
        restart,
        onProgress: (next) => {
          if (!signal.aborted) setProgress(next);
        },
      });
      if (!signal.aborted) {
        setResult(generated);
        props.onUseMap(generated);
      }
    });
  return (
    <div className='glossa-map-generation-form'>
      {props.kind === 'chapter' && (
        <label className='glossa-passage-label'>
          {_('Chapter')}
          <select
            className='glossa-passage-select eink-bordered'
            aria-label={_('Chapter')}
            value={chapterId}
            onChange={(event) => {
              model.cancel();
              setResult(null);
              setChapterId(event.target.value);
            }}
          >
            <option value=''>{_('Choose a chapter')}</option>
            {access?.chapters.map((c) => (
              <option key={c.id} value={c.id}>
                {'　'.repeat(c.depth)}
                {c.title}
              </option>
            ))}
          </select>
        </label>
      )}
      {!access && <p role='status'>{_('Reading ranges are available for reflowable EPUBs.')}</p>}
      <ConversationModelPicker
        config={model.config}
        ready={model.ready}
        openSettings={model.openSettings}
      />
      <div className='glossa-map-generation-actions'>
        {model.busy ? (
          <button type='button' className='glossa-button eink-bordered' onClick={model.cancel}>
            {_('Stop')}
          </button>
        ) : (
          <button
            type='button'
            className='glossa-button glossa-button-primary'
            disabled={checking || !model.ready || !access || (props.kind === 'chapter' && !chapter)}
            onClick={() => void generate()}
          >
            {progress?.phase === 'ready'
              ? _('Restore generated map')
              : progress?.total
                ? _('Continue generation')
                : _('Generate mind map')}
          </button>
        )}
        {!model.busy && !!progress?.total && (
          <button
            type='button'
            className='glossa-button'
            disabled={checking || !model.ready}
            onClick={() => void generate(true)}
          >
            {_('Start again')}
          </button>
        )}
        {result && !model.busy && (
          <button type='button' className='glossa-button' onClick={() => props.onUseMap(result)}>
            {_('Use generated map')}
          </button>
        )}
      </div>
      {model.busy ? (
        <p role='status'>
          {progress?.phase === 'synthesis' || progress?.phase === 'ready'
            ? _('Organizing the mind map…')
            : progress?.phase === 'inventory'
              ? _('Reading segments {{current}} / {{total}}…', {
                  current: progress.completed + 1,
                  total: progress.total,
                })
              : _('Checking reading material…')}
        </p>
      ) : (
        !!progress?.total && (
          <p role='status'>
            {_('Saved progress: {{completed}} / {{total}} segments', {
              completed: progress.completed,
              total: progress.total,
            })}
          </p>
        )
      )}
      {(model.error || resumeError) && <p role='alert'>{_(model.error || resumeError)}</p>}
    </div>
  );
}

export function BranchGeneration(
  props: ReadingPanelProps & {
    map: LocalMap;
    nodeId: string;
    onUseMap: (map: ReadingMindmap) => void;
    onClose: () => void;
  },
) {
  const _ = useTranslation();
  const model = useMapGeneration(props.bookKey);
  const [result, setResult] = useState<ReadingMindmap | null>(null);
  const node = props.map.nodes.find((n) => n.id === props.nodeId);
  const generate = () =>
    model.run(async (config, signal) => {
      setResult(null);
      const generated = await expandMapNode({
        map: props.map,
        nodeId: props.nodeId,
        config,
        signal,
        access: createEpubBookAccess(props.bookDoc, props.book.hash),
      });
      if (!signal.aborted) {
        setResult(generated);
        props.onUseMap(generated);
      }
    });
  return (
    <section
      className='glossa-map-generation-form glossa-workmap-generation'
      aria-label={_('Expand idea')}
    >
      <strong dir='auto'>{node?.label}</strong>
      <ConversationModelPicker
        config={model.config}
        ready={model.ready}
        openSettings={model.openSettings}
      />
      <div className='glossa-map-generation-actions'>
        {model.busy ? (
          <button type='button' className='glossa-button eink-bordered' onClick={model.cancel}>
            {_('Stop')}
          </button>
        ) : (
          <button
            type='button'
            className='glossa-button glossa-button-primary'
            disabled={!model.ready}
            onClick={() => void generate()}
          >
            {_('Generate details')}
          </button>
        )}
        {result && !model.busy && (
          <button type='button' className='glossa-button' onClick={() => props.onUseMap(result)}>
            {_('Add generated details')}
          </button>
        )}
        <button type='button' className='glossa-button' onClick={props.onClose}>
          {_('Close')}
        </button>
      </div>
      {model.busy && <p role='status'>{_('Expanding idea…')}</p>}
      {model.error && <p role='alert'>{_(model.error)}</p>}
    </section>
  );
}
