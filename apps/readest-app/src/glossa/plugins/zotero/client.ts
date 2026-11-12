import { z } from 'zod';
const keySchema = z.string().regex(/^[A-Z0-9]{8}$/);
const text = z.string().max(100000);
export const collectionSchema = z.object({
  key: keySchema,
  data: z.object({
    name: text,
    parentCollection: z.union([keySchema, z.literal(false)]).optional(),
  }),
});
export const itemSchema = z.object({
  key: keySchema,
  data: z.object({
    itemType: text,
    title: text.optional(),
    date: text.optional(),
    publicationTitle: text.optional(),
    DOI: text.optional(),
    creators: z
      .array(
        z.object({ firstName: text.optional(), lastName: text.optional(), name: text.optional() }),
      )
      .max(500)
      .optional(),
    contentType: text.optional(),
    filename: text.optional(),
    parentItem: keySchema.optional(),
  }),
});
export type ZoteroCollection = z.infer<typeof collectionSchema>;
export type ZoteroItem = z.infer<typeof itemSchema>;
export const PAGE_SIZE = 100;
export const creatorText = (item: ZoteroItem) =>
  item.data.creators
    ?.map((c) => c.name || [c.firstName, c.lastName].filter(Boolean).join(' '))
    .join('; ') || '';
export const isReadableAttachment = (item: ZoteroItem) =>
  item.data.itemType === 'attachment' &&
  (['application/pdf', 'application/epub+zip'].includes(item.data.contentType ?? '') ||
    /\.(pdf|epub)$/i.test(item.data.filename ?? ''));
export function attachmentPath(value: string): string {
  const url = new URL(value.trim());
  if (url.protocol !== 'file:' || url.hostname || url.search || url.hash)
    throw new Error('Zotero attachment is not a local PDF or EPUB.');
  const path = decodeURIComponent(url.pathname);
  if (/[\x00-\x1f]/.test(path) || !/\.(pdf|epub)$/i.test(path))
    throw new Error('Zotero attachment is not a local PDF or EPUB.');
  return /^\/[A-Za-z]:\//.test(path) ? path.slice(1) : path;
}
/** Narrow read-only client: callers cannot supply a URL, method, credentials or headers. */
export class ZoteroClient {
  constructor(private readonly fetcher: typeof fetch) {}
  private async read(path: string, signal: AbortSignal): Promise<string> {
    signal.throwIfAborted();
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, 15000);
    try {
      const response = await this.fetcher(`http://127.0.0.1:23119/api/users/0/${path}`, {
        method: 'GET',
        redirect: 'error',
        credentials: 'omit',
        signal: controller.signal,
        headers: { 'Zotero-API-Version': '3' },
      });
      signal.throwIfAborted();
      if (response.status === 403)
        throw new Error('Enable local application access in Zotero Settings → Advanced.');
      if (!response.ok) throw new Error('Zotero could not read this collection or attachment.');
      if (Number(response.headers.get('Content-Length')) > 2_000_000)
        throw new Error('Zotero response is too large.');
      // Stream with a byte bound; a missing Content-Length cannot bypass the limit.
      const reader = response.body?.getReader();
      if (!reader) throw new Error('Zotero returned an invalid response.');
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          signal.throwIfAborted();
          controller.signal.throwIfAborted();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > 2_000_000) throw new Error('Zotero response is too large.');
          chunks.push(chunk.value);
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return new TextDecoder().decode(bytes);
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    }
  }
  private page(start: number) {
    if (!Number.isSafeInteger(start) || start < 0) throw new Error('Invalid Zotero page.');
    return `limit=${PAGE_SIZE}&start=${start}`;
  }
  async collections(start: number, signal: AbortSignal): Promise<ZoteroCollection[]> {
    return z
      .array(collectionSchema)
      .max(PAGE_SIZE)
      .parse(JSON.parse(await this.read(`collections?${this.page(start)}`, signal)));
  }
  async items(collection: string, start: number, signal: AbortSignal): Promise<ZoteroItem[]> {
    const path = collection ? `collections/${keySchema.parse(collection)}/items/top` : 'items/top';
    return z
      .array(itemSchema)
      .max(PAGE_SIZE)
      .parse(JSON.parse(await this.read(`${path}?${this.page(start)}`, signal)));
  }
  async attachments(item: ZoteroItem, signal: AbortSignal): Promise<ZoteroItem[]> {
    if (isReadableAttachment(item)) return [item];
    const attachments: ZoteroItem[] = [];
    for (let start = 0; start < 1000; start += PAGE_SIZE) {
      const rows = z
        .array(itemSchema)
        .max(PAGE_SIZE)
        .parse(
          JSON.parse(
            await this.read(
              `items/${keySchema.parse(item.key)}/children?${this.page(start)}`,
              signal,
            ),
          ),
        );
      attachments.push(...rows.filter(isReadableAttachment));
      if (rows.length < PAGE_SIZE) return attachments;
    }
    throw new Error('Zotero response is too large.');
  }
  async file(item: ZoteroItem, signal: AbortSignal): Promise<string> {
    if (!isReadableAttachment(item))
      throw new Error('Zotero attachment is not a local PDF or EPUB.');
    return attachmentPath(
      await this.read(`items/${keySchema.parse(item.key)}/file/view/url`, signal),
    );
  }
}
