import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { adaptInlineGlyphImages, inlineGlyphColorStyles } from '@/utils/inlineGlyphImages';
import { getStyles, type ThemeCode } from '@/utils/style';
import {
  DEFAULT_BOOK_FONT,
  DEFAULT_BOOK_LAYOUT,
  DEFAULT_BOOK_STYLE,
  DEFAULT_VIEW_CONFIG,
  DEFAULT_BOOK_LANGUAGE,
} from '@/services/constants';
import type { ViewSettings } from '@/types/book';

function glyph(color = '#000', transparent = false, size = 20) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  if (!transparent) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, size, size);
  }
  ctx.fillStyle = color;
  ctx.fillRect(5, 3, 3, 14);
  ctx.fillRect(12, 3, 3, 14);
  ctx.fillRect(8, 9, 4, 3);
  return canvas.toDataURL(transparent ? 'image/png' : 'image/jpeg');
}

async function chapter(markup: string) {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'width:600px;height:260px;border:0';
  document.body.append(frame);
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(`<html><head><style>
    html { --theme-fg-color: #c9c8b8; background:#20231f; color:var(--theme-fg-color); }
    body { margin:24px; font:24px serif; }
    img { filter:invert(1); mix-blend-mode:screen; vertical-align:-0.15em; }
    ${inlineGlyphColorStyles}
  </style></head><body>${markup}</body></html>`);
  doc.close();
  await Promise.all(Array.from(doc.images).map((img) => img.decode().catch(() => {})));
  return doc;
}

// Check painted pixels, not just computed CSS: hidden filter definitions can
// report the correct flood color while painting black in a real iframe.
async function expectGlyphPixels(doc: Document, ink: number[], paper: number[], name: string) {
  const frame = doc.defaultView!.frameElement as HTMLIFrameElement;
  const shot = await page.elementLocator(frame).screenshot({
    base64: true,
    path: `.glossa-dev/qa/inline-glyph-${name}.png`,
  });
  const raster = new Image();
  raster.src = `data:image/png;base64,${shot.base64}`;
  await raster.decode();
  const canvas = document.createElement('canvas');
  canvas.width = raster.naturalWidth;
  canvas.height = raster.naturalHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(raster, 0, 0);
  const scale = raster.naturalWidth / frame.clientWidth;
  const rect = doc.images[0]!.getBoundingClientRect();
  for (const [x, y, expected] of [
    [6, 5, ink],
    [1, 1, paper],
  ] as const) {
    const pixel = ctx.getImageData(
      Math.floor((rect.left + x) * scale),
      Math.floor((rect.top + y) * scale),
      1,
      1,
    ).data;
    expected.forEach((channel, i) => expect(Math.abs(pixel[i]! - channel)).toBeLessThanOrEqual(3));
  }
}

afterEach(() => {
  document.querySelectorAll('iframe').forEach((frame) => frame.remove());
  vi.restoreAllMocks();
});

describe('EPUB inline glyph images', () => {
  it.each([
    [false, false, false],
    [true, false, false],
    [true, true, false],
    [false, false, true],
  ])('works with reader CSS: dark=%s, invert=%s, vertical=%s', async (dark, invert, vertical) => {
    const doc = await chapter(
      `<p><font>Example</font> <img src="${glyph()}"> <font>text</font></p>`,
    );
    const settings = {
      ...DEFAULT_BOOK_FONT,
      ...DEFAULT_BOOK_LAYOUT,
      ...DEFAULT_BOOK_STYLE,
      ...DEFAULT_VIEW_CONFIG,
      ...DEFAULT_BOOK_LANGUAGE,
      overrideColor: true,
      invertImgColorInDark: invert,
      vertical,
    } as ViewSettings;
    const theme = {
      bg: dark ? '#20231f' : '#f1e8d6',
      fg: dark ? '#c9c8b8' : '#30281e',
      primary: '#807060',
      isDarkMode: dark,
      palette: {},
    } as ThemeCode;
    const style = doc.createElement('style');
    style.textContent = getStyles(settings, theme);
    doc.head.append(style);
    adaptInlineGlyphImages(doc);
    await expect.poll(() => doc.images[0]!.classList.contains('glossa-inline-glyph')).toBe(true);
    expect(doc.defaultView!.getComputedStyle(doc.images[0]!).filter).toContain(
      'glossa-inline-glyph-ink',
    );
    expect(doc.defaultView!.getComputedStyle(doc.images[0]!).mixBlendMode).toBe('normal');
    doc.documentElement.style.setProperty('--theme-fg-color', '#000');
    doc.documentElement.style.background = '#fff';
    expect(doc.defaultView!.getComputedStyle(doc.querySelector('feFlood')!).floodColor).toBe(
      'rgb(0, 0, 0)',
    );
  });

  it('adapts JPEG glyphs amid wrapped text without changing the source, layout or text anchors', async () => {
    const source = glyph();
    const doc = await chapter(
      `<p><font>Example m</font> <img width="20" height="20" src="${source}"> <font>n text</font></p>`,
    );
    const img = doc.images[0]!;
    const nodes = Array.from(doc.body.querySelector('p')!.childNodes);
    const before = img.getBoundingClientRect().toJSON();
    adaptInlineGlyphImages(doc);
    await expect.poll(() => img.classList.contains('glossa-inline-glyph')).toBe(true);
    expect(img.src).toBe(source);
    expect(Array.from(doc.body.querySelector('p')!.childNodes)).toEqual(nodes);
    expect(img.getBoundingClientRect().toJSON()).toEqual(before);
    expect(doc.defaultView!.getComputedStyle(img).mixBlendMode).toBe('normal');
    expect(doc.defaultView!.getComputedStyle(img).verticalAlign).toBe('-3.6px');
    expect(doc.defaultView!.getComputedStyle(doc.querySelector('feFlood')!).floodColor).toBe(
      'rgb(201, 200, 184)',
    );
    await expectGlyphPixels(doc, [201, 200, 184], [32, 35, 31], 'dark');
    doc.documentElement.style.setProperty('--theme-fg-color', '#30281e');
    doc.documentElement.style.background = '#f1e8d6';
    expect(doc.defaultView!.getComputedStyle(doc.querySelector('feFlood')!).floodColor).toBe(
      'rgb(48, 40, 30)',
    );
    adaptInlineGlyphImages(doc);
    expect(doc.querySelectorAll('#glossa-inline-glyph-ink')).toHaveLength(1);
    await expectGlyphPixels(doc, [48, 40, 30], [241, 232, 214], 'light');
    doc.documentElement.style.setProperty('--theme-fg-color', '#000');
    doc.documentElement.style.background = '#fff';
    const base = doc.createElement('base');
    base.href = 'https://epub-resources.invalid/';
    doc.head.prepend(base);
    await expectGlyphPixels(doc, [0, 0, 0], [255, 255, 255], 'eink-base');
  });

  it('preserves colored, transparent, large, isolated and linked images', async () => {
    const mono = glyph();
    const doc = await chapter(`<p>text
      <img src="${glyph('#d02030')}"><img src="${glyph('#000', true)}">
      <img src="${glyph('#000', false, 200)}" width="20" height="20">
      <img src="${mono}" width="100" height="100">
      <a href="#note"><img src="${mono}"></a></p>
      <p><img src="${mono}"></p>`);
    adaptInlineGlyphImages(doc);
    await new Promise<void>((resolve) => setTimeout(resolve, 40));
    expect(doc.querySelectorAll('.glossa-inline-glyph')).toHaveLength(0);
    expect(doc.querySelector('svg')).toBeNull();
  });

  it('handles late loading and discards work for a removed chapter', async () => {
    const doc = await chapter('<p>text <span><img width="20" height="20"></span> text</p>');
    const img = doc.images[0]!;
    img.src = glyph();
    adaptInlineGlyphImages(doc);
    await expect.poll(() => img.classList.contains('glossa-inline-glyph')).toBe(true);
    const detached = await chapter(`<p>text <img src="${glyph()}"> text</p>`);
    adaptInlineGlyphImages(detached);
    detached.defaultView!.frameElement!.remove();
    await new Promise<void>((resolve) => setTimeout(resolve, 40));
    expect(detached.querySelector('svg')).toBeNull();
  });

  it('leaves unreadable pixels and failed image loads untouched', async () => {
    const doc = await chapter(`<p>text <img src="${glyph()}"> text</p>`);
    vi.spyOn(doc.defaultView!.HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
      throw new DOMException('Tainted canvas', 'SecurityError');
    });
    adaptInlineGlyphImages(doc);
    await new Promise<void>((resolve) => setTimeout(resolve, 40));
    expect(doc.querySelector('.glossa-inline-glyph')).toBeNull();
    const failed = await chapter('<p>text <img src="data:image/png;base64,broken"> text</p>');
    adaptInlineGlyphImages(failed);
    await new Promise<void>((resolve) => setTimeout(resolve, 40));
    expect(failed.querySelector('.glossa-inline-glyph')).toBeNull();
  });
});
