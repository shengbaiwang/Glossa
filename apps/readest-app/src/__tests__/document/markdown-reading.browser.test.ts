import { afterEach, describe, expect, it } from 'vitest';
import { commands } from 'vitest/browser';
import { makeMarkdownBook } from '@/utils/md';
import { getStyles } from '@/utils/style';
import { applyScrollableStyle, applyTableTouchScroll, findScrollableBox } from '@/utils/scrollable';
import { collectTextBlocks } from '@/glossa/context/text';
import { resolveSource } from '@/glossa/citations/sources';
import { createReflowableBookAccess } from '@/glossa/harness/reflowable';
import { CFI } from '@/libs/document';
import type { BookDoc } from '@/libs/document';
import type { ViewSettings } from '@/types/book';
import * as defaults from '@/services/constants';

const settings = {
  ...defaults.DEFAULT_BOOK_FONT,
  ...defaults.DEFAULT_BOOK_LAYOUT,
  ...defaults.DEFAULT_BOOK_STYLE,
  ...defaults.DEFAULT_BOOK_LANGUAGE,
  ...defaults.DEFAULT_VIEW_CONFIG,
  ...defaults.DEFAULT_TTS_CONFIG,
  ...defaults.DEFAULT_TRANSLATOR_CONFIG,
  ...defaults.DEFAULT_ANNOTATOR_CONFIG,
  ...defaults.DEFAULT_SCREEN_CONFIG,
} as ViewSettings;
let frame: HTMLIFrameElement | undefined;
let book: BookDoc | undefined;
afterEach(() => {
  frame?.remove();
  book?.destroy?.();
});
const render = async (content: string, zoom = 1) => {
  book = await makeMarkdownBook(new File([content], 'Original.md'));
  const section = book.sections[0]!;
  const doc = await section.createDocument();
  const style = doc.createElement('style');
  style.textContent = getStyles(settings, undefined, []);
  doc.head.append(style);
  frame = document.createElement('iframe');
  Object.assign(frame.style, {
    position: 'absolute',
    left: '0',
    top: '0',
    width: '360px',
    height: '700px',
    border: '0',
  });
  const loaded = new Promise<void>((resolve) =>
    frame!.addEventListener('load', () => resolve(), { once: true }),
  );
  frame.srcdoc = new XMLSerializer().serializeToString(doc);
  document.body.append(frame);
  await loaded;
  const visible = frame.contentDocument!;
  visible.documentElement.style.zoom = String(zoom);
  applyScrollableStyle(visible);
  applyTableTouchScroll(visible);
  return visible;
};

describe('Markdown reading in the shared renderer', () => {
  it('preserves code lines and scrolls wide content locally without widening a narrow page', async () => {
    const long = 'a_long_identifier_'.repeat(30);
    const table = Array.from({ length: 12 }, (_, i) => `Column ${i}`).join(' | ');
    const divider = Array.from({ length: 12 }, () => '---').join(' | ');
    const doc = await render(
      `# Original\n\n~~~python\ndef run():\n    return ${long}\n~~~\n\n| ${table} |\n| ${divider} |\n| ${table} |`,
    );
    const pre = doc.querySelector('pre')!;
    const style = doc.defaultView!.getComputedStyle(pre);
    expect(style.whiteSpace).toBe('pre');
    expect(pre.scrollWidth).toBeGreaterThan(pre.clientWidth + 100);
    expect(findScrollableBox(pre.querySelector('code'))).toBe(pre);
    const wrapper = doc.querySelector<HTMLElement>('.scroll-wrapper')!;
    expect(wrapper.scrollWidth).toBeGreaterThan(wrapper.clientWidth + 100);
    expect(doc.documentElement.scrollWidth).toBeLessThanOrEqual(362);
    pre.scrollLeft = 120;
    wrapper.scrollLeft = 120;
    expect(pre.scrollLeft).toBeGreaterThan(0);
    expect(wrapper.scrollLeft).toBeGreaterThan(0);
    let leaked = false;
    doc.addEventListener('wheel', () => {
      leaked = true;
    });
    pre.dispatchEvent(new WheelEvent('wheel', { deltaX: 20, bubbles: true }));
    expect(leaked).toBe(false);
  });

  it.each([
    1, 1.25,
  ])('keeps a real mouse selection and its CFI across reopen at zoom %s', async (zoom) => {
    const content =
      '# Original\n\nOriginal evidence for annotation recovery.\n\n## Detail\n\nA separate conclusion.';
    const doc = await render(content, zoom);
    const text = doc.querySelector('p')!.firstChild!;
    const range = doc.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 17);
    const rect = range.getBoundingClientRect();
    const origin = frame!.getBoundingClientRect();
    await commands.dragPDFText(
      { x: origin.x + rect.left + 1, y: origin.y + rect.top + rect.height / 2 },
      { x: origin.x + rect.right, y: origin.y + rect.top + rect.height / 2 },
    );
    const selection = doc.getSelection()!;
    expect(selection.toString()).toContain('Original evidence');
    const selected = selection.getRangeAt(0).cloneRange();
    const cfi = CFI.joinIndir(book!.sections[0]!.cfi, CFI.fromRange(selected));
    const reopened = await makeMarkdownBook(new File([content], 'Original.md'));
    const raw = await reopened.sections[0]!.createDocument();
    const parts = CFI.parse(cfi);
    (parts.parent ?? parts).shift();
    expect(CFI.toRange(raw, parts)!.toString()).toBe(selection.toString());
    const sources = await createReflowableBookAccess(book!, 'original').readAll(
      new AbortController().signal,
    );
    const source = sources.find((item) => item.text.includes('Original evidence'))!;
    expect(await resolveSource(reopened, source)).toMatchObject({ text: source.text });
    expect(collectTextBlocks(doc).some((block) => block.text === source.text)).toBe(true);
    reopened.destroy?.();
  });
});
