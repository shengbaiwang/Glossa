import { getBundledReadingFontCSS } from './readingFonts';
import { getFilename } from '@/utils/path';
import { md5Fingerprint } from '@/utils/md5';

export type FontFormat = 'ttf' | 'otf' | 'woff' | 'woff2';

/** Set the fallback document language so common system fonts use the right regional glyphs. */
export const mountAdditionalFonts = async (document: Document, language?: string) => {
  const styleId = 'glossa-reading-fonts';
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = getBundledReadingFontCSS();
    document.head.appendChild(style);
  }
  const root = document.documentElement;
  if (
    !root.lang &&
    !root.getAttributeNS('http://www.w3.org/XML/1998/namespace', 'lang') &&
    language
  ) {
    root.lang = language;
  }
};

export type FontStyle = 'normal' | 'italic' | 'oblique';

export interface CustomFont {
  id: string;
  name: string;
  path: string;
  family?: string;
  style?: string;
  weight?: number;
  variable?: boolean;

  /**
   * Cross-device content hash. Set on imports new enough to participate
   * in replica sync (`partialMD5 + byteSize + filename`). Legacy fonts
   * (created before replica sync) leave this undefined and never publish
   * — re-import to enable cloud sync.
   */
  contentId?: string;
  /**
   * Per-font directory name relative to the `Fonts` base. New imports
   * land at `<bundleDir>/<filename>`; legacy imports keep their flat
   * `<filename>` path with bundleDir undefined.
   */
  bundleDir?: string;
  /** File size in bytes — used by the replica manifest, optional for legacy. */
  byteSize?: number;
  /**
   * On a remote-pulled placeholder, set to true until the binary download
   * lands. The transfer-complete handler clears it via the font store's
   * markAvailable hook.
   */
  unavailable?: boolean;
  /**
   * Reincarnation token — opaque value that revives a tombstoned remote
   * row. Mirrors the dictionary mechanism.
   */
  reincarnation?: string;

  downloadedAt?: number;
  deletedAt?: number;

  blobUrl?: string;
  loaded?: boolean;
  error?: string;
}

export type CustomFontInfo = Partial<CustomFont> &
  Required<Pick<CustomFont, 'path' | 'name' | 'family' | 'style' | 'weight' | 'variable'>>;

export function getFontName(path: string): string {
  const fileName = getFilename(path);
  return fileName.replace(/\.(ttf|otf|woff|woff2)$/i, '');
}

export function getFontId(name: string): string {
  return md5Fingerprint(name);
}

export function getFontFormat(path: string): FontFormat {
  const extension = path.toLowerCase().split('.').pop();
  switch (extension) {
    case 'ttf':
      return 'ttf';
    case 'otf':
      return 'otf';
    case 'woff':
      return 'woff';
    case 'woff2':
      return 'woff2';
    default:
      return 'ttf';
  }
}

export function getMimeType(format: FontFormat): string {
  const types = { ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2' };
  return types[format] || 'font/ttf';
}

export function getCSSFormatString(format: FontFormat): string {
  const formats = { ttf: 'truetype', otf: 'opentype', woff: 'woff', woff2: 'woff2' };
  return formats[format] || 'truetype';
}

export function createFontFamily(name: string): string {
  return name.replace(/\s+/g, ' ').trim();
}

export function createFontCSS(font: CustomFont): string {
  const format = getFontFormat(font.path);
  const cssFormat = getCSSFormatString(format);
  const fontFamily = createFontFamily(font.family || font.name);
  const fontStyle = font.style || 'normal';
  const fontWeight = font.weight || 400;
  const variable = font.variable || false;
  if (!font.blobUrl) {
    throw new Error(`Blob URL not available for font: ${font.name}`);
  }

  const css = `
    @font-face {
      font-family: "${fontFamily}";
      ${variable ? '' : `font-style: ${fontStyle};`}
      ${variable ? '' : `font-weight: ${fontWeight};`}
      src: url("${font.blobUrl}") format("${cssFormat}");
      font-display: swap;
    }
  `;

  return css;
}

export function createCustomFont(
  path: string,
  options?: Partial<Omit<CustomFont, 'id' | 'path'>>,
): CustomFont {
  const name = options?.name || getFontName(path);
  // Spread options first so replica-sync fields (contentId, bundleDir,
  // byteSize) flow through from the import path. The earlier hand-
  // picked field list silently dropped them, leaving font.contentId
  // undefined → publishFontUpsert short-circuited on `!contentId` →
  // newly imported fonts never published their replica row.
  return {
    ...options,
    id: getFontId(name),
    name,
    path,
  };
}

export const mountCustomFont = (document: Document, font: CustomFont) => {
  const fontStyleId = `custom-font-${font.id}`;
  const styleElement = document.getElementById(fontStyleId) || document.createElement('style');
  styleElement.id = fontStyleId;
  styleElement.textContent = createFontCSS(font);

  if (!styleElement.parentNode) {
    document.head.appendChild(styleElement);
  }
};
