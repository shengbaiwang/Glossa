import { previewScope } from './previewCache';
import { sessionTokens } from '@glossa/sync-contracts';
import { CloudRangeReader, readerTransport } from '@glossa/sync-contracts/reader';
import { syncOrigin } from './config';
import { supabase } from '@/utils/supabase';
import { isGlossaAuthConfigured } from '@/glossa/account/config';
import type { Book } from '@/types/book';
import { CloudReaderFile } from './readerFile';

export async function syncDeviceId(origin: string) {
  const key = 'glossa.sync.device.' + origin;
  const readOrCreate = () => {
    const prior = localStorage.getItem(key);
    if (prior) return prior;
    const device = crypto.randomUUID();
    localStorage.setItem(key, device);
    return device;
  };
  return navigator.locks ? navigator.locks.request(key, readOrCreate) : readOrCreate();
}
type Tokens = { access_token: string; refresh_token: string; expires: number };
type Connection = { key: string; tokens?: Tokens; pending?: Promise<Tokens> };
let connection: Connection | undefined;
export async function syncAccess(origin: string, subject: string) {
  if (origin !== syncOrigin()) throw new Error('sync_origin_changed');
  if (!isGlossaAuthConfigured()) throw new Error('sync_login_required');
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session || session.user.id !== subject) throw new Error('sync_account_changed');
  // Concurrent calls in one reader share a refresh family. Each window holds its own secrets in memory.
  const key = JSON.stringify([origin, subject, session.user.last_sign_in_at]);
  if (connection?.key !== key) connection = { key };
  const c = connection;
  if (c.tokens && c.tokens.expires > Date.now() + 15000) return c.tokens.access_token;
  if (!c.pending)
    c.pending = (async () => {
      const post = (route: string, body: unknown) =>
        fetch(origin + '/v1/auth/' + route, {
          method: 'POST',
          credentials: 'omit',
          redirect: 'error',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      let res: Response | undefined;
      if (c.tokens) {
        const refresh = c.tokens.refresh_token;
        c.tokens = undefined;
        res = await post('refresh', { refresh_token: refresh });
        if (!res.ok && res.status !== 401) throw new Error('sync_refresh_' + res.status);
      }
      if (!res?.ok) {
        const device = await syncDeviceId(origin);
        res = await post('exchange', {
          identity_token: session.access_token,
          device_id: device,
          device_name: 'Glossa Reader',
        });
      }
      if (!res.ok) throw new Error('sync_exchange_' + res.status);
      const tokens = sessionTokens.parse(await res.json());
      return (c.tokens = { ...tokens, expires: Date.now() + tokens.expires_in * 1000 });
    })().finally(() => {
      c.pending = undefined;
    });
  return (await c.pending).access_token;
}
export async function openCloudBook(book: Book, controller?: AbortController) {
  const p = book.glossaCloud;
  const origin = syncOrigin();
  if (!origin || p?.origin !== origin || (book.format !== 'PDF' && book.format !== 'EPUB'))
    throw new Error('cloud_book_unavailable');
  const reader = await CloudRangeReader.open(
    readerTransport(origin, () => syncAccess(origin, p.subject)),
    p,
    controller,
  );
  const ext = book.format.toLowerCase();
  return new CloudReaderFile(
    reader,
    book.originalFilename?.toLowerCase().endsWith('.' + ext)
      ? book.originalFilename
      : book.title + '.' + ext,
    ext === 'pdf' ? 'application/pdf' : 'application/epub+zip',
    previewScope(p),
  );
}
