import { describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { DocumentLoader } from '@/libs/document';
import { observeReadingSurface } from '@/glossa/plugins/readingActivity';
import type { FoliateView } from '@/types/view';
import type { ReadingActivity } from '@/glossa/plugins/readingTime';
import 'foliate-js/view.js';
import { convertPageToEpub } from '@/services/send/conversion/convertToEpub';

const fixture = async (format: 'pdf' | 'epub' | 'web') => {
  if (format === 'web') {
    const content = Array.from(
      { length: 48 },
      (_, i) =>
        `<p>Paragraph ${i + 1}. Researchers compare the order of dated field notes, transcribe the dates, and verify each transcription against the original notebook before interpreting the observations.</p>`,
    ).join('');
    const result = await convertPageToEpub(
      `<!DOCTYPE html><html><head><title>Field notes</title></head><body><main><article><h1>Field notes</h1>${content}</article></main></body></html>`,
      'https://example.invalid/field-notes',
    );
    return result.file;
  }
  const name = `glossa-reading-sample.${format}`;
  const bytes = await fetch(`/src/__tests__/fixtures/data/${name}`).then((r) => r.arrayBuffer());
  return new File([bytes], name);
};

const native = isTauri();
const status = () =>
  invoke<{
    activeSessionId: string | null;
    intervals: { id: string; sessionId: string; durationMs: number }[];
  }>('reading_time', { activity: { type: 'status' } });

describe('trusted reading surface', () => {
  it.each([
    'pdf',
    'epub',
    'web',
  ] as const)('accepts a real page action and ignores programmatic moves for %s', async (format) => {
    if (native) {
      expect(await invoke('get_app_identifier')).toBe('com.bilingify.readest.webdriver-test');
    }
    const { book } = await new DocumentLoader(await fixture(format)).open();
    if (book.rendition) book.rendition.spread = 'none';
    const view = document.createElement('foliate-view') as FoliateView;
    view.style.cssText = 'display:block;width:520px;height:340px';
    const cell = document.createElement('div');
    const actions = document.createElement('div');
    actions.dataset['readingTurn'] = '';
    const next = document.createElement('button');
    next.textContent = 'Test next page';
    let trustedClicks = 0;
    next.onclick = (event) => {
      if (event.isTrusted) trustedClicks++;
      void view.next();
    };
    actions.append(next);
    cell.append(actions, view);
    document.body.append(cell);

    const session = { sessionId: crypto.randomUUID(), bookHash: `reading-time-test-${format}` };
    const seen: ReadingActivity[] = [];
    let activation: Promise<unknown> | undefined;
    let detach: (() => void) | undefined;
    try {
      await view.open(book);
      if (format === 'pdf') view.renderer.setAttribute('spread', 'none');
      await view.goTo(0);
      detach = observeReadingSurface(
        view,
        'test-key',
        () => true,
        cell,
        (kind) => {
          seen.push(kind);
          if (native)
            activation = invoke('reading_time', { activity: { type: 'signal', session, kind } });
        },
      );
      await view.next();
      expect(seen).toEqual([]);
      await view.goTo(0);
      view.dispatchEvent(new WheelEvent('wheel', { deltaY: 150, bubbles: true }));
      await view.next();
      expect(seen).toEqual([]);
      await view.goTo(0);

      const cfiBeforeClick = view.lastLocation?.cfi;
      await userEvent.click(page.getByRole('button', { name: 'Test next page' }));
      await expect.poll(() => trustedClicks).toBe(1);
      await expect.poll(() => view.lastLocation?.cfi).not.toBe(cfiBeforeClick);
      await expect.poll(() => seen.length).toBeGreaterThan(0);
      expect(seen[0]).toBe('turn');
      if (native) {
        await activation;
        expect((await status()).activeSessionId).toBe(session.sessionId);
        await new Promise((resolve) => setTimeout(resolve, 150));
        await invoke('reading_time', { activity: { type: 'pause', session } });
        const result = await status();
        expect(result.activeSessionId).toBeNull();
        expect(
          result.intervals.find((row) => row.sessionId === session.sessionId)?.durationMs,
        ).toBeGreaterThan(0);
        await invoke('reading_time', {
          activity: {
            type: 'ack',
            ids: result.intervals
              .filter((row) => row.sessionId === session.sessionId)
              .map(({ id }) => id),
          },
        });
      }
    } finally {
      detach?.();
      if (native) await invoke('reading_time', { activity: { type: 'pause', session } });
      view.close();
      cell.remove();
      await book.destroy?.();
    }
  }, 30_000);
});
