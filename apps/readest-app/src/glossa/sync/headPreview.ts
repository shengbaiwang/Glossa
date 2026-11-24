import { z } from 'zod';
import type { PreparedFile, PublicationAsset } from '@glossa/sync-contracts/publisher';

export const previewCodec = 'glossa-head-preview-v1';
export const maxPreviewBytes = 4 << 20;
export const previewLongEdge = 960;
const maxChapterChars = 256 * 1024;
const base = {
  source_file_blake3: z.string().regex(/^[a-f0-9]{64}$/),
  file_bytes: z.number().int().positive(),
};
const pack = z.discriminatedUnion('format', [
  z.strictObject({ ...base, format: z.literal('pdf'), pages: z.array(z.string()).min(1).max(3) }),
  z.strictObject({
    ...base,
    format: z.literal('epub'),
    text: z.string().trim().min(1).max(maxChapterChars),
  }),
]);
export type HeadPreview = z.infer<typeof pack>;

function staticPage(url: string) {
  const prefix = 'data:image/png;base64,';
  if (!url.startsWith(prefix)) return false;
  const bytes = atob(url.slice(prefix.length));
  const header = Uint8Array.from(bytes.slice(0, 24), (c) => c.charCodeAt(0));
  const view = new DataView(header.buffer);
  if (
    header.length !== 24 ||
    view.getUint32(0) !== 0x89504e47 ||
    view.getUint32(4) !== 0x0d0a1a0a ||
    view.getUint32(8) !== 13 ||
    view.getUint32(12) !== 0x49484452 ||
    ![view.getUint32(16), view.getUint32(20)].every((n) => n >= 1 && n <= previewLongEdge)
  )
    return false;
  let sawPixels = false;
  for (let at = 8; at + 12 <= bytes.length; ) {
    const length =
      bytes.charCodeAt(at) * 0x1000000 +
      bytes.charCodeAt(at + 1) * 0x10000 +
      bytes.charCodeAt(at + 2) * 0x100 +
      bytes.charCodeAt(at + 3);
    const kind = bytes.slice(at + 4, at + 8);
    const end = at + 12 + length;
    if (
      end > bytes.length ||
      ['acTL', 'fcTL', 'fdAT'].includes(kind) ||
      (kind === 'IHDR' && at !== 8)
    )
      return false;
    if (kind === 'IDAT') sawPixels = true;
    if (kind === 'IEND') return sawPixels && length === 0 && end === bytes.length;
    at = end;
  }
  return false;
}

export function decodeHeadPreview(bytes: Uint8Array, hash: string, size: number, format: string) {
  if (bytes.length > maxPreviewBytes) throw new Error('preview_too_large');
  const preview = pack.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  if (
    preview.source_file_blake3 !== hash ||
    preview.file_bytes !== size ||
    preview.format !== format
  )
    throw new Error('preview_source_mismatch');
  if (preview.format === 'pdf' && !preview.pages.every(staticPage))
    throw new Error('invalid_preview_page');
  return preview;
}

export class HeadPreviewBuilder {
  pageCount?: number;
  private pages: string[] = [];
  private text?: string;
  private disabled = false;
  private chars = 0;
  constructor(
    private plan: Pick<PreparedFile, 'file_blake3' | 'file_bytes'>,
    private format: 'pdf' | 'epub',
  ) {}

  addPage(index: number, canvas: HTMLCanvasElement) {
    if (this.disabled || index !== this.pages.length || index >= 3) return;
    let encoded = canvas.toDataURL('image/png');
    const budget = Math.floor((maxPreviewBytes - 1024) / 3);
    if (encoded.length > budget) {
      const smaller = document.createElement('canvas');
      const scale = Math.min(0.8, Math.sqrt(budget / encoded.length) * 0.9);
      smaller.width = Math.max(1, Math.floor(canvas.width * scale));
      smaller.height = Math.max(1, Math.floor(canvas.height * scale));
      const ctx = smaller.getContext('2d');
      if (!ctx) return;
      try {
        ctx.drawImage(canvas, 0, 0, smaller.width, smaller.height);
        encoded = smaller.toDataURL('image/png');
      } finally {
        smaller.width = smaller.height = 0;
      }
    }
    if (!encoded.startsWith('data:image/png;base64,')) return;
    this.chars += encoded.length;
    if (this.chars > maxPreviewBytes) {
      this.disabled = true;
      this.pages = [];
    } else this.pages.push(encoded);
  }

  addChapter(doc: Document) {
    if (this.text || this.disabled) return;
    const body = doc.getElementsByTagNameNS('*', 'body')[0]?.cloneNode(true) as Element | undefined;
    if (!body) return;
    body.querySelectorAll('script,style,template,nav,[hidden]').forEach((node) => node.remove());
    // The text preview requires a complete textual chapter. A graphical chapter
    // or mathematical layout belongs in the normal EPUB renderer.
    if (body.querySelector('img,svg,math,video,audio,object,canvas,iframe,table')) return;
    for (const el of body.querySelectorAll(
      'p,h1,h2,h3,h4,h5,h6,div,section,blockquote,li,br,pre',
    )) {
      el.prepend('\n');
      el.append('\n');
    }
    const text = (body.textContent ?? '').trim().replace(/\n(?:[\t \r]*\n)+/g, '\n\n');
    if (text && text.length <= maxChapterChars) this.text = text;
  }

  finish(): PublicationAsset | undefined {
    if (this.disabled) return;
    const base = { source_file_blake3: this.plan.file_blake3, file_bytes: this.plan.file_bytes };
    const payload =
      this.format === 'pdf'
        ? this.pageCount &&
          this.pages.length === Math.min(3, this.pageCount) && {
            ...base,
            format: 'pdf',
            pages: this.pages,
          }
        : this.text && { ...base, format: 'epub', text: this.text };
    if (!payload) return;
    const body = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    if (body.size > maxPreviewBytes) return;
    return { role: 'head_preview_chunk', codec_version: previewCodec, body, mime: body.type };
  }
}
