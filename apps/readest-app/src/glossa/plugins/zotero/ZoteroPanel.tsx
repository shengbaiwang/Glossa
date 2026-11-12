import { useEffect, useRef, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { isTauriAppPlatform } from '@/services/environment';
import { useOpenBook } from '@/app/library/hooks/useOpenBook';
import { isPluginEnabled } from '../registry';
import { runPluginTask } from '../runtime';
import { importZoteroAttachment } from './import';
import {
  ZoteroClient,
  creatorText,
  PAGE_SIZE,
  type ZoteroCollection,
  type ZoteroItem,
} from './client';

export default function ZoteroPanel({ onOpened }: { onOpened?: () => void }) {
  const _ = useTranslation();
  const { appService } = useEnv();
  const settings = useSettingsStore((state) => state.settings);
  const enabled = isPluginEnabled(settings, 'zotero');
  const supported = isTauriAppPlatform() && appService && !appService.isMobileApp;
  const [connected, setConnected] = useState(false);
  const [collections, setCollections] = useState<ZoteroCollection[]>([]);
  const [moreCollections, setMoreCollections] = useState(false);
  const [collection, setCollection] = useState('');
  const [items, setItems] = useState<ZoteroItem[]>([]);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<ZoteroItem | null>(null);
  const [attachments, setAttachments] = useState<ZoteroItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState<(() => void) | null>(null);
  const active = useRef<AbortController | null>(null);
  const client = useRef<ZoteroClient | null>(null);
  const { openBook } = useOpenBook({ setLoading: setBusy, handleBookDownload: async () => false });
  useEffect(() => () => active.current?.abort(), []);
  useEffect(() => {
    if (!enabled) active.current?.abort();
  }, [enabled]);

  const run = async (task: (client: ZoteroClient, signal: AbortSignal) => Promise<void>) => {
    if (!enabled || !supported || active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError('');
    setRetry(null);
    try {
      await runPluginTask(
        'zotero',
        async (signal) => {
          if (!client.current) {
            const { fetch } = await import('@tauri-apps/plugin-http');
            signal.throwIfAborted();
            client.current = new ZoteroClient((url, options) =>
              fetch(url, { ...options, maxRedirections: 0, connectTimeout: 10000 }),
            );
          }
          await task(client.current, signal);
        },
        controller.signal,
      );
    } catch (err) {
      if (!controller.signal.aborted) {
        const message = err instanceof Error ? err.message : '';
        const known = [
          'Enable local application access in Zotero Settings → Advanced.',
          'Zotero could not read this collection or attachment.',
          'Zotero attachment is not a local PDF or EPUB.',
          'Zotero response is too large.',
        ];
        setError(
          _(
            known.includes(message)
              ? message
              : 'Could not complete the Zotero operation. Check that Zotero is running and the attachment is available, then retry.',
          ),
        );
        setRetry(() => () => void run(task));
      }
    } finally {
      if (active.current === controller) {
        active.current = null;
        setBusy(false);
      }
    }
  };
  const loadItems = (key: string, start = 0) =>
    void run(async (api, signal) => {
      const rows = await api.items(key, start, signal);
      signal.throwIfAborted();
      setItems(rows);
      setCollection(key);
      setPage(start);
      setSelected(null);
      setAttachments(null);
    });
  const connect = () =>
    void run(async (api, signal) => {
      const groups = await api.collections(0, signal);
      const rows = await api.items('', 0, signal);
      signal.throwIfAborted();
      setCollections(groups);
      setMoreCollections(groups.length === PAGE_SIZE);
      setItems(rows);
      setPage(0);
      setCollection('');
      setConnected(true);
      setSelected(null);
      setAttachments(null);
    });
  const readAttachment = (parent: ZoteroItem, attachment: ZoteroItem) =>
    void run(async (api, signal) => {
      const path = await api.file(attachment, signal);
      signal.throwIfAborted();
      const book = await importZoteroAttachment(
        appService!,
        path,
        {
          itemKey: parent.data.parentItem ?? parent.key,
          attachmentKey: attachment.key,
          title: parent.data.title ?? '',
          creators: creatorText(parent),
          date: parent.data.date,
          publicationTitle: parent.data.publicationTitle,
          DOI: parent.data.DOI,
        },
        signal,
      );
      signal.throwIfAborted();
      await openBook(book);
      onOpened?.();
    });
  const select = (item: ZoteroItem) =>
    void run(async (api, signal) => {
      const rows = await api.attachments(item, signal);
      signal.throwIfAborted();
      setSelected(item);
      setAttachments(rows);
    });
  if (!supported) return <p>{_('Zotero local access is available in the desktop app.')}</p>;
  if (!enabled)
    return <p>{_('Enable the Zotero plugin to connect. Existing books and notes are kept.')}</p>;
  return (
    <section aria-label='Zotero' className='space-y-3'>
      <div className='flex flex-wrap items-center gap-2'>
        <button
          type='button'
          className='glossa-button eink-bordered'
          disabled={busy}
          onClick={connect}
        >
          {_(connected ? 'Refresh' : 'Connect to Zotero')}
        </button>
        {connected && (
          <select
            aria-label={_('Zotero collection')}
            className='select select-sm eink-bordered min-w-0 max-w-full'
            disabled={busy}
            value={collection}
            onChange={(e) => loadItems(e.target.value)}
          >
            <option value=''>{_('My Library')}</option>
            {collections.map((c) => (
              <option key={c.key} value={c.key}>
                {c.data.parentCollection
                  ? `${collections.find((p) => p.key === c.data.parentCollection)?.data.name ?? '…'} / `
                  : ''}
                {c.data.name}
              </option>
            ))}
          </select>
        )}
        {moreCollections && (
          <button
            type='button'
            className='glossa-button eink-bordered'
            disabled={busy}
            onClick={() =>
              void run(async (api, signal) => {
                const rows = await api.collections(collections.length, signal);
                signal.throwIfAborted();
                setCollections([...collections, ...rows]);
                setMoreCollections(rows.length === PAGE_SIZE);
              })
            }
          >
            {_('More collections')}
          </button>
        )}
        {busy && (
          <button
            type='button'
            className='glossa-button eink-bordered'
            onClick={() => active.current?.abort()}
          >
            {_('Cancel')}
          </button>
        )}
      </div>
      {!connected && (
        <p className='glossa-supporting-text'>
          {_(
            'Read local Zotero collections. Opening an attachment saves a reading copy in Academic; Zotero files and metadata stay unchanged.',
          )}
        </p>
      )}
      {busy && <p role='status'>{_('Loading...')}</p>}
      {error && (
        <div role='alert'>
          <p>{error}</p>
          {retry && (
            <button
              type='button'
              className='glossa-button eink-bordered'
              disabled={busy}
              onClick={retry}
            >
              {_('Retry')}
            </button>
          )}
        </div>
      )}
      {connected && items.length === 0 && !busy && <p>{_('No references in this collection.')}</p>}
      <ul className='divide-base-300 divide-y'>
        {items.map((item) => (
          <li key={item.key} className='py-2'>
            <button
              type='button'
              className='w-full text-start'
              disabled={busy}
              aria-expanded={selected?.key === item.key}
              onClick={() => select(item)}
            >
              <span className='block break-words font-medium'>
                {item.data.title || _('Untitled')}
              </span>
              <span className='glossa-supporting-text'>
                {[creatorText(item), item.data.date, item.data.publicationTitle]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </button>
            {selected?.key === item.key && (
              <div className='mt-2 space-y-2 ps-3'>
                {item.data.DOI && <p className='break-all text-sm'>DOI: {item.data.DOI}</p>}
                <button
                  type='button'
                  className='glossa-button eink-bordered'
                  disabled={busy}
                  onClick={() =>
                    void run(async (_api, signal) => {
                      const { openUrl } = await import('@tauri-apps/plugin-opener');
                      signal.throwIfAborted();
                      await openUrl(
                        `zotero://select/library/items/${item.data.parentItem ?? item.key}`,
                      );
                    })
                  }
                >
                  {_('Show in Zotero')}
                </button>
                {attachments?.length === 0 && (
                  <p className='glossa-supporting-text'>
                    {_(
                      'No local PDF or EPUB attachment. Download or attach a file in Zotero, then retry.',
                    )}
                  </p>
                )}
                {attachments?.map((a) => (
                  <button
                    key={a.key}
                    type='button'
                    className='glossa-button eink-bordered block max-w-full truncate'
                    disabled={busy}
                    onClick={() => readAttachment(item, a)}
                  >
                    {_('Read')} · {a.data.filename || a.data.title || a.key}
                  </button>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
      {connected && (
        <div className='flex gap-2'>
          {page > 0 && (
            <button
              type='button'
              className='glossa-button eink-bordered'
              disabled={busy}
              onClick={() => loadItems(collection, Math.max(0, page - PAGE_SIZE))}
            >
              {_('Previous')}
            </button>
          )}
          {items.length === PAGE_SIZE && (
            <button
              type='button'
              className='glossa-button eink-bordered'
              disabled={busy}
              onClick={() => loadItems(collection, page + PAGE_SIZE)}
            >
              {_('Next')}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
