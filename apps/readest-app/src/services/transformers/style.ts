import { transformStylesheet } from '@/utils/style';
import {
  adaptDeclarationBlockForDark,
  adaptTextColorForDark,
  getThemeDarkPalette,
  type DarkPalette,
} from '@/utils/adaptiveTextColor';
import type { Transformer } from './types';

const STYLE_ATTR_RE = /style=("([^"]*)"|'([^']*)')/gi;
const FONT_TAG_RE = /<font\b[^>]*>/gi;
const FONT_COLOR_ATTR_RE = /\scolor=("([^"]*)"|'([^']*)')/i;
const FONT_STYLE_ATTR_RE = /\sstyle=("([^"]*)"|'([^']*)')/i;

/**
 * Dark-mode adaptation for inline `style="…"` attributes: lifts text colors
 * that fail contrast on the dark page and wraps pure light backgrounds as
 * theme-live light-dark() values. Inert under a light color-scheme.
 */
const adaptInlineStyleAttributes = (html: string, dark: DarkPalette): string =>
  html.replace(STYLE_ATTR_RE, (attr, _quoted, dq: string, sq: string) => {
    const style = dq ?? sq;
    const adapted = adaptDeclarationBlockForDark(style, dark);
    if (adapted === style) return attr;
    // Keep the original quote style: the value may contain the other kind of
    // quote (e.g. style='font-family: "Kai"'), which double-quoting would break.
    const quote = dq !== undefined ? '"' : "'";
    return `style=${quote}${adapted}${quote}`;
  });

/**
 * Dark-mode adaptation for `<font color="…">` presentational attributes. The
 * original attribute stays as the fallback for engines without light-dark();
 * the adaptive value is carried in a `style` attribute, which wins over the
 * presentational hint where supported.
 */
const adaptFontColorAttributes = (html: string, dark: DarkPalette): string =>
  html.replace(FONT_TAG_RE, (tag) => {
    const colorAttr = tag.match(FONT_COLOR_ATTR_RE);
    if (!colorAttr) return tag;
    const raw = (colorAttr[2] ?? colorAttr[3] ?? '').trim();
    const adapted = adaptTextColorForDark(raw, dark);
    if (!adapted) return tag;
    const styleAttr = tag.match(FONT_STYLE_ATTR_RE);
    if (styleAttr) {
      const style = (styleAttr[2] ?? styleAttr[3] ?? '').trim();
      // An explicit style color already wins over the color attribute and has
      // been adapted by the inline pass above; don't fight it.
      if (/(^|[\s;])color\s*:/i.test(style)) return tag;
      const separator = style.endsWith(';') || style === '' ? '' : ';';
      const quote = styleAttr[1]!.startsWith('"') ? '"' : "'";
      return tag.replace(
        FONT_STYLE_ATTR_RE,
        ` style=${quote}${style}${separator} color: ${adapted};${quote}`,
      );
    }
    return tag.replace(/(\/?)>$/, (_end, slash: string) => ` style="color: ${adapted};"${slash}>`);
  });

export const styleTransformer: Transformer = {
  name: 'style',

  transform: async (ctx) => {
    let result = ctx.content;
    if (ctx.isFixedLayout) return result;

    const styleMatches = [...result.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)];

    for (const match of styleMatches) {
      const [full, css] = match;
      const transformed = await transformStylesheet(
        css!,
        ctx.width || window.innerWidth,
        ctx.height || window.innerHeight,
        ctx.viewSettings.vertical,
      );
      result = result.replace(full, `<style>${transformed}</style>`);
    }

    const darkPalette = getThemeDarkPalette();
    result = adaptFontColorAttributes(adaptInlineStyleAttributes(result, darkPalette), darkPalette);

    return result;
  },
};
