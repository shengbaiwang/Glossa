import { expect, it } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { invoke } from '@tauri-apps/api/core';
import { DocumentLoader } from '@/libs/document';
import { observeReadingSurface } from '@/glossa/plugins/readingActivity';
import type { FoliateView } from '@/types/view';
import 'foliate-js/view.js';

declare module 'vitest/browser' {
  interface BrowserCommands {
    readingTimeCover(mode: 'partial' | 'full' | 'close'): Promise<number>;
  }
}

interface Interval {
  id: string;
  sessionId: string;
  durationMs: number;
  startMs: number;
}

const send = (activity: Record<string, unknown>) =>
  invoke<{ activeSessionId: string | null; intervals: Interval[] }>('reading_time', { activity });

const makeSession = (bookHash: string) => ({ bookHash, sessionId: crypto.randomUUID() });
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const endOf = ({ startMs, durationMs }: Interval) => startMs + durationMs;

it.skipIf(process.env['GLOSSA_READING_TIME_WINDOW_TEST'] !== '1')(
  'keeps counting behind another app while visible and stops when fully covered',
  async () => {
    expect(await invoke('get_app_identifier')).toBe('com.bilingify.readest.webdriver-test');
    const session = makeSession('reading-time-qa-cover');
    const start = Date.now();
    expect((await send({ type: 'signal', session, kind: 'turn' })).activeSessionId).toBe(
      session.sessionId,
    );
    try {
      const partialAt = await commands.readingTimeCover('partial');
      await wait(1500);
      const whileVisible = await send({ type: 'status' });
      expect(whileVisible.activeSessionId).toBe(session.sessionId);
      await commands.readingTimeCover('close');

      const coveredAt = await commands.readingTimeCover('full');
      // The native notification must stop the timer without a status request
      // while the window is covered.
      await wait(2000);
      const uncoveredAt = await commands.readingTimeCover('close');
      await wait(300);
      const snapshot = await send({ type: 'status' });
      const rows = snapshot.intervals.filter(({ sessionId }) => sessionId === session.sessionId);
      const end = Math.max(...rows.map(endOf));
      await commands.recordNativePDFEvidence({
        start,
        partialAt,
        activeWhilePartlyVisible: whileVisible.activeSessionId === session.sessionId,
        coveredAt,
        uncoveredAt,
        end,
        activeAfterUncover: snapshot.activeSessionId,
      });
      expect(end).toBeGreaterThan(partialAt + 1000);
      expect(end).toBeLessThanOrEqual(coveredAt + 1200);
      expect(uncoveredAt - end).toBeGreaterThan(800);
      expect(snapshot.activeSessionId).toBeNull();
      expect((await send({ type: 'signal', session, kind: 'turn' })).activeSessionId).toBe(
        session.sessionId,
      );
    } finally {
      await commands.readingTimeCover('close');
      const { intervals } = await send({ type: 'pause', session });
      await send({
        type: 'ack',
        ids: intervals
          .filter(({ sessionId }) => sessionId === session.sessionId)
          .map(({ id }) => id),
      });
    }
  },
  25_000,
);

it.skipIf(process.env['GLOSSA_READING_TIME_WINDOW_TEST'] !== '1')(
  'transfers exclusive native time between two side-by-side books on trusted turns',
  async () => {
    expect(await invoke('get_app_identifier')).toBe('com.bilingify.readest.webdriver-test');
    await page.viewport(1000, 900);
    const split = document.createElement('div');
    split.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:16px';
    document.body.append(split);
    const sessions = [makeSession('reading-time-qa-epub'), makeSession('reading-time-qa-pdf')];
    const cleanup: (() => Promise<void>)[] = [];
    const paths = ['glossa-reading-sample.epub', 'glossa-reading-sample.pdf'];
    try {
      for (const [index, name] of paths.entries()) {
        const bytes = await fetch(`/src/__tests__/fixtures/data/${name}`).then((r) =>
          r.arrayBuffer(),
        );
        const { book } = await new DocumentLoader(new File([bytes], name)).open();
        const cell = document.createElement('div');
        const actions = document.createElement('div');
        actions.dataset['readingTurn'] = '';
        const next = document.createElement('button');
        next.textContent = `Next in book ${index + 1}`;
        const view = document.createElement('foliate-view') as FoliateView;
        view.style.cssText = 'display:block;width:100%;height:340px';
        next.onclick = () => void view.next();
        actions.append(next);
        cell.append(actions, view);
        split.append(cell);
        await view.open(book);
        if (name.endsWith('.pdf')) view.renderer.setAttribute('spread', 'none');
        await view.goTo(0);
        const detach = observeReadingSurface(
          view,
          name,
          () => true,
          cell,
          (kind) => {
            void send({ type: 'signal', session: sessions[index], kind });
          },
        );
        cleanup.push(async () => {
          detach();
          view.close();
          await book.destroy?.();
        });
      }

      for (const index of [0, 1, 0]) {
        await userEvent.click(page.getByRole('button', { name: `Next in book ${index + 1}` }));
        await expect
          .poll(async () => (await send({ type: 'status' })).activeSessionId)
          .toBe(sessions[index]!.sessionId);
        await wait(300);
      }
      await send({ type: 'pause', session: sessions[1] });
      expect((await send({ type: 'status' })).activeSessionId).toBe(sessions[0]!.sessionId);
      const { intervals } = await send({ type: 'pause', session: sessions[0] });
      const rows = intervals.filter((row) =>
        sessions.some(({ sessionId }) => sessionId === row.sessionId),
      );
      const books = rows.map((row) =>
        sessions.findIndex(({ sessionId }) => row.sessionId === sessionId),
      );
      const durations = rows.map((row) => row.durationMs);
      const gaps = rows.slice(1).map((row, index) => row.startMs - endOf(rows[index]!));
      await commands.recordNativePDFEvidence({ splitBooks: books, durations, gaps });
      expect(books).toEqual([0, 1, 0]);
      expect(durations.every((duration) => duration >= 300)).toBe(true);
      expect(gaps.every((gap) => gap >= -1)).toBe(true);
    } finally {
      for (const session of sessions) await send({ type: 'pause', session });
      const { intervals } = await send({ type: 'status' });
      await send({
        type: 'ack',
        ids: intervals
          .filter((row) => sessions.some(({ sessionId }) => sessionId === row.sessionId))
          .map(({ id }) => id),
      });
      await Promise.all(cleanup.map((dispose) => dispose()));
      split.remove();
    }
  },
  30_000,
);
