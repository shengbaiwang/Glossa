import { Marked } from 'marked';
import { z } from 'zod';
import { sanitizeMarkdownHtml } from './sanitize';
import { parseFrontmatter } from './mdFrontmatter';
import { dataUrlToBytes } from './image';
import i18next from 'i18next';

const MAGIC = 'Glossa Markdown snapshot 1\n';
const MAX_IMAGE = 8 * 1024 * 1024;
const MAX_RESOURCES = 32 * 1024 * 1024;
const MAX_SNAPSHOT = 64 * 1024 * 1024;
const MAX_COUNT = 64;
const raster = /^(?:image\/(?:png|jpeg|gif|webp|avif|bmp))$/;
const resourceSchema = z.object({
  src: z.string().max(4096),
  data: z.string().max(MAX_IMAGE * 1.4),
});
const snapshotSchema = z.object({
  version: z.literal(1),
  original: z.string().max(MAX_SNAPSHOT),
  resources: z.array(resourceSchema).max(MAX_COUNT),
});
const base64 = (bytes: Uint8Array): string => {
  let text = '';
  for (let i = 0; i < bytes.length; i += 8192)
    text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text);
};
const unbase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
const isRelative = (src: string) => !/^(?:[a-z][a-z\d+.-]*:|[\\/]|#)/i.test(src);
const imageMime = (bytes: Uint8Array): string | null => {
  if (bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  const header = new TextDecoder().decode(bytes.subarray(0, 16));
  if (/^GIF8[79]a/.test(header)) return 'image/gif';
  if (header.startsWith('RIFF') && header.slice(8, 12) === 'WEBP') return 'image/webp';
  if (header.slice(4, 12) === 'ftypavif' || header.slice(4, 12) === 'ftypavis') return 'image/avif';
  if (header.startsWith('BM')) return 'image/bmp';
  return null;
};
const safeImage = (src: string): boolean => {
  if (
    src.length > MAX_IMAGE * 1.4 ||
    !/^data:image\/(?:png|jpeg|gif|webp|avif|bmp);base64,/i.test(src)
  )
    return false;
  try {
    const parsed = dataUrlToBytes(src);
    return raster.test(parsed.mimeType) && imageMime(parsed.bytes) === parsed.mimeType;
  } catch {
    return false;
  }
};

export async function readMarkdownInput(
  file: File,
): Promise<{ original: Uint8Array; resources: Map<string, string> }> {
  const prefix = await file.slice(0, MAGIC.length).text();
  if (prefix !== MAGIC)
    return { original: new Uint8Array(await file.arrayBuffer()), resources: new Map() };
  if (file.size > MAX_SNAPSHOT) throw new Error('Markdown snapshot is too large');
  const parsed = snapshotSchema.parse(JSON.parse((await file.text()).slice(MAGIC.length)));
  const resources = new Map<string, string>();
  let total = 0;
  for (const item of parsed.resources) {
    total += item.data.length;
    if (
      total > MAX_RESOURCES * 1.4 ||
      !isRelative(item.src) ||
      !safeImage(item.data) ||
      resources.has(item.src)
    )
      throw new Error('Invalid Markdown resource snapshot');
    resources.set(item.src, item.data);
  }
  return { original: unbase64(parsed.original), resources };
}

/** A deterministic managed snapshot includes the exact source and referenced bytes.
 * Its complete-file fingerprint distinguishes editions with different images. */
export async function snapshotMarkdownFile(
  file: File,
  read: (src: string) => Promise<File | null>,
  signal?: AbortSignal,
): Promise<File> {
  signal?.throwIfAborted();
  if (file.size > 16 * 1024 * 1024 || (await file.slice(0, MAGIC.length).text()) === MAGIC)
    return file;
  const original = new Uint8Array(await file.arrayBuffer());
  const { body } = parseFrontmatter(new TextDecoder().decode(original));
  const fragment = sanitizeMarkdownHtml(await new Marked({ gfm: true }).parse(body));
  const paths = [
    ...new Set(
      Array.from(
        fragment.querySelectorAll('img'),
        (img) => img.getAttribute('data-glossa-image') ?? '',
      ),
    ),
  ]
    .filter((src) => src && src.length <= 4096 && isRelative(src))
    .sort()
    .slice(0, MAX_COUNT);
  const resources: { src: string; data: string }[] = [];
  let total = 0;
  for (const src of paths) {
    signal?.throwIfAborted();
    let asset: File | null = null;
    try {
      asset = await read(src);
      if (!asset || asset.size > MAX_IMAGE || total + asset.size > MAX_RESOURCES) continue;
      const bytes = new Uint8Array(await asset.arrayBuffer());
      const mime = imageMime(bytes);
      if (!mime) continue;
      resources.push({ src, data: `data:${mime};base64,${base64(bytes)}` });
      total += bytes.length;
    } catch {
      signal?.throwIfAborted();
    } finally {
      await (asset as (File & { close?: () => Promise<void> }) | null)?.close?.();
    }
  }
  signal?.throwIfAborted();
  if (!resources.length) return file;
  return new File(
    [MAGIC, JSON.stringify({ version: 1, original: base64(original), resources })],
    file.name,
    { type: 'text/markdown' },
  );
}

/** Resolve only within the explicitly selected root, including percent-encoded paths. */
export function resolveMarkdownResourcePath(
  root: string,
  filename: string,
  src: string,
): string | null {
  let relative: string;
  try {
    relative = decodeURIComponent(src.split(/[?#]/)[0]!).replace(/\\/g, '/');
  } catch {
    return null;
  }
  if (!isRelative(relative) || relative.includes('\0')) return null;
  const base = root.replace(/\\/g, '/').replace(/\/+$/, '');
  const name = filename.replace(/\\/g, '/');
  if (!name.startsWith(base + '/')) return null;
  const parts = name
    .slice(base.length + 1)
    .split('/')
    .slice(0, -1);
  for (const part of relative.split('/')) {
    if (part === '..') {
      if (!parts.length) return null;
      parts.pop();
    } else if (part && part !== '.') parts.push(part);
  }
  return `${base}/${parts.join('/')}`;
}

export function resolveMarkdownImages(
  root: HTMLElement,
  resources: ReadonlyMap<string, string>,
): void {
  for (const img of root.querySelectorAll('img')) {
    const src = img.getAttribute('data-glossa-image') ?? '';
    img.removeAttribute('data-glossa-image');
    const data = resources.get(src) ?? (safeImage(src) ? src : undefined);
    if (data) {
      img.setAttribute('src', data);
      continue;
    }
    const placeholder = root.ownerDocument.createElement('span');
    placeholder.className = 'md-missing-image';
    const reason = /^https?:|^\/\//i.test(src)
      ? 'Remote image not loaded'
      : 'Local image missing; import its folder to include images';
    placeholder.textContent = `${img.getAttribute('alt') || i18next.t('Image')} · ${i18next.t(reason)}`;
    img.replaceWith(placeholder);
  }
}
