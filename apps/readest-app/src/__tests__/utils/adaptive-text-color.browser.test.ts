import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { styleTransformer } from '@/services/transformers/style';
import type { TransformContext } from '@/services/transformers/types';
import { getStyles, type ThemeCode } from '@/utils/style';
import {
  DEFAULT_BOOK_FONT,
  DEFAULT_BOOK_LAYOUT,
  DEFAULT_BOOK_STYLE,
  DEFAULT_VIEW_CONFIG,
  DEFAULT_BOOK_LANGUAGE,
} from '@/services/constants';
import type { ViewSettings } from '@/types/book';

const viewSettings = {
  ...DEFAULT_BOOK_FONT,
  ...DEFAULT_BOOK_LAYOUT,
  ...DEFAULT_BOOK_STYLE,
  ...DEFAULT_VIEW_CONFIG,
  ...DEFAULT_BOOK_LANGUAGE,
  vertical: false,
} as ViewSettings;

const darkTheme = {
  bg: '#20211f',
  fg: '#edeee8',
  primary: '#807060',
  isDarkMode: true,
  palette: {},
} as ThemeCode;

const lightTheme = {
  bg: '#faf9f6',
  fg: '#242521',
  primary: '#807060',
  isDarkMode: false,
  palette: {},
} as ThemeCode;

const FIXTURE = `<style>
  .note { color: #555; }
  .navy { color: #000080; }
  .green { color: #006400; }
  .boxlight { background-color: #ffffff; color: #333; }
  .boxmid { background-color: #bbb; color: #222; }
</style>
<p class="plain">正文 plain</p>
<p class="note">注释 note</p>
<p class="navy">笺疏 navy</p>
<p class="green">标题 green</p>
<p class="boxlight">浅底文字 boxlight</p>
<p class="boxmid">灰底文字 boxmid</p>
<p style="color: maroon">inline maroon</p>
<p><font color="#000080">font navy</font></p>`;

type Rgb = [number, number, number];

const gammaEncode = (c: number) =>
  (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055) * 255;

const oklabToRgb = (L: number, a: number, b: number): Rgb => {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  const R = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const G = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const B = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return [clamp(gammaEncode(R)), clamp(gammaEncode(G)), clamp(gammaEncode(B))];
};

/**
 * Chromium serializes computed colors in their specified space: plain hex as
 * rgb(), but color-mix(in oklch, …) as oklch(…) and color-mix(in srgb, …) /
 * light-dark(var(…)) as color(srgb …). Normalize them all to 0–255 sRGB.
 */
const parseRgb = (css: string): Rgb => {
  const rgb = css.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  const srgb = css.match(/color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
  if (srgb) {
    return [Number(srgb[1]) * 255, Number(srgb[2]) * 255, Number(srgb[3]) * 255].map((v) =>
      Math.round(v),
    ) as Rgb;
  }
  const oklch = css.match(/oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
  if (oklch) {
    const L = Number(oklch[1]);
    const C = Number(oklch[2]);
    const h = (Number(oklch[3]) * Math.PI) / 180;
    return oklabToRgb(L, C * Math.cos(h), C * Math.sin(h));
  }
  const oklab = css.match(/oklab\(\s*([\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)/);
  if (oklab) return oklabToRgb(Number(oklab[1]), Number(oklab[2]), Number(oklab[3]));
  throw new Error(`unsupported color: ${css}`);
};

const channel = (v: number) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};

const luminance = ([r, g, b]: Rgb) =>
  0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

const contrast = (a: Rgb, b: Rgb) => {
  const sorted = [luminance(a), luminance(b)].sort((x, y) => y - x);
  const hi = sorted[0]!;
  const lo = sorted[1]!;
  return (hi + 0.05) / (lo + 0.05);
};

const hueOf = ([r, g, b]: Rgb) => {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  let h = 0;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return (h * 60 + 360) % 360;
};

const hexToRgb = (hex: string): Rgb => {
  const match = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!match) throw new Error(`not a hex color: ${hex}`);
  return [parseInt(match[1]!, 16), parseInt(match[2]!, 16), parseInt(match[3]!, 16)];
};

/** The painted page color: the reader keeps the book iframe transparent and
 * the paginator wrapper paints the theme background. */
const pageBgOf = (theme: ThemeCode) => hexToRgb(theme.bg);

const expectHueNear = (rgb: Rgb, expected: number, tolerance: number) => {
  const h = hueOf(rgb);
  const diff = Math.min(Math.abs(h - expected), 360 - Math.abs(h - expected));
  expect(diff).toBeLessThanOrEqual(tolerance);
};

async function renderChapter(theme: ThemeCode) {
  const ctx: TransformContext = {
    bookKey: 'adaptive-color-test',
    viewSettings,
    userLocale: 'zh-CN',
    isFixedLayout: false,
    content: FIXTURE,
    transformers: [],
  };
  const transformed = await styleTransformer.transform(ctx);

  const frame = document.createElement('iframe');
  frame.style.cssText = 'width:640px;height:480px;border:0';
  // The book iframe stays transparent in the reader; the paginator wrapper
  // paints the theme page background. Play that role here.
  frame.style.background = theme.bg;
  document.body.append(frame);
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(`<html><head></head><body>${transformed}</body></html>`);
  doc.close();
  const readerStyle = doc.createElement('style');
  readerStyle.textContent = getStyles(viewSettings, theme);
  doc.head.append(readerStyle);
  return { doc, frame, readerStyle };
}

const computed = (doc: Document, selector: string) => {
  const el = doc.querySelector(selector);
  if (!el) throw new Error(`missing element: ${selector}`);
  return doc.defaultView!.getComputedStyle(el);
};

async function screenshot(frame: HTMLIFrameElement, name: string) {
  await page.elementLocator(frame).screenshot({
    base64: true,
    path: `.glossa-dev/qa/adaptive-color-${name}.png`,
  });
}

afterEach(() => {
  document.querySelectorAll('iframe').forEach((frame) => frame.remove());
});

describe('dark-mode adaptive book text colors', () => {
  it('keeps body and notes readable with the book emphasis order on the dark page', async () => {
    const { doc, frame } = await renderChapter(darkTheme);
    const pageBg = pageBgOf(darkTheme);

    const plain = parseRgb(computed(doc, '.plain').color);
    expect(contrast(plain, pageBg)).toBeGreaterThan(10);

    // 注释稍弱于正文，但仍清楚可读
    const note = parseRgb(computed(doc, '.note').color);
    expect(contrast(note, pageBg)).toBeGreaterThanOrEqual(4.5);
    expect(luminance(note)).toBeLessThan(luminance(plain));
    await screenshot(frame, 'dark');
  });

  it('lifts dark chromatic colors with hues preserved on the dark page', async () => {
    const { doc } = await renderChapter(darkTheme);
    const pageBg = pageBgOf(darkTheme);

    const navy = parseRgb(computed(doc, '.navy').color);
    expectHueNear(navy, 240, 30);
    expect(contrast(navy, pageBg)).toBeGreaterThanOrEqual(4.5);

    const green = parseRgb(computed(doc, '.green').color);
    expectHueNear(green, 120, 35);
    expect(contrast(green, pageBg)).toBeGreaterThanOrEqual(4.5);

    const maroon = parseRgb(computed(doc, 'p[style]').color);
    expectHueNear(maroon, 0, 25);
    expect(contrast(maroon, pageBg)).toBeGreaterThanOrEqual(4.5);

    const fontNavy = parseRgb(computed(doc, 'font').color);
    expectHueNear(fontNavy, 240, 30);
    expect(contrast(fontNavy, pageBg)).toBeGreaterThanOrEqual(4.5);
  });

  it('adapts light-backed text together with its background but never touches kept surfaces', async () => {
    const { doc } = await renderChapter(darkTheme);
    const pageBg = pageBgOf(darkTheme);

    const boxlight = computed(doc, '.boxlight');
    expect(parseRgb(boxlight.backgroundColor)).toEqual(pageBg);
    expect(contrast(parseRgb(boxlight.color), pageBg)).toBeGreaterThanOrEqual(4.5);

    const boxmid = computed(doc, '.boxmid');
    expect(parseRgb(boxmid.backgroundColor)).toEqual([187, 187, 187]);
    expect(parseRgb(boxmid.color)).toEqual([34, 34, 34]);
  });

  it('restores the original book colors under a light color-scheme and re-adapts back', async () => {
    const { doc, frame, readerStyle } = await renderChapter(darkTheme);
    // Simulate exactly what the reader does on a theme switch: the injected
    // reader stylesheet and the paginator background change; the section is
    // not reloaded.
    readerStyle.textContent = getStyles(viewSettings, lightTheme);
    frame.style.background = lightTheme.bg;

    expect(parseRgb(computed(doc, '.note').color)).toEqual([85, 85, 85]);
    expect(parseRgb(computed(doc, '.navy').color)).toEqual([0, 0, 128]);
    expect(parseRgb(computed(doc, '.green').color)).toEqual([0, 100, 0]);
    expect(parseRgb(computed(doc, '.boxlight').backgroundColor)).toEqual([255, 255, 255]);
    expect(parseRgb(computed(doc, '.boxlight').color)).toEqual([51, 51, 51]);
    expect(parseRgb(computed(doc, 'font').color)).toEqual([0, 0, 128]);
    await screenshot(frame, 'light-restored');

    readerStyle.textContent = getStyles(viewSettings, darkTheme);
    frame.style.background = darkTheme.bg;
    const navy = parseRgb(computed(doc, '.navy').color);
    expectHueNear(navy, 240, 30);
    expect(navy).not.toEqual([0, 0, 128]);
    await screenshot(frame, 'dark-readapted');
  });
});
