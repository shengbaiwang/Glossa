import { expect, it } from 'vitest';
import { commands } from 'vitest/browser';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window';

declare module 'vitest/browser' {
  interface BrowserCommands {
    readingTimeSystemEvents(): Promise<string>;
    recordNativePDFEvidence(evidence: Record<string, unknown>): Promise<void>;
  }
}

interface Snapshot {
  activeSessionId: string | null;
  intervals: { id: string; sessionId: string; durationMs: number; startMs: number }[];
}

const send = (activity: Record<string, unknown>) => invoke<Snapshot>('reading_time', { activity });

const systemEvents = async (after: number) =>
  (await commands.readingTimeSystemEvents())
    .trim()
    .split('\n')
    .map((line) => {
      const [time, name] = line.split(' ');
      return { at: Number(time), name };
    })
    .filter(({ at }) => at >= after);

const cases = [
  ['locked', 'unlocked'],
  ['sleeping', 'awake'],
] as const;

it.skipIf(process.env['GLOSSA_READING_TIME_SYSTEM_TEST'] !== '1').each(cases)(
  'cuts off real Mac %s intervals and requires fresh activity after %s',
  async (suspend, resume) => {
    expect(await invoke('get_app_identifier')).toBe('com.bilingify.readest.webdriver-test');
    const window = getCurrentWindow();
    await window.setSize(new LogicalSize(480, 360));
    await window.setAlwaysOnTop(true);
    await window.setVisibleOnAllWorkspaces(true);
    try {
      let session = { bookHash: `reading-time-qa-${suspend}`, sessionId: crypto.randomUUID() };
      let start = Date.now();
      const signal = () => send({ type: 'signal', session, kind: 'turn' });
      // The system may still be restoring visibility as the unlock is observed.
      await expect
        .poll(
          async () => {
            start = Date.now();
            return (await signal()).activeSessionId;
          },
          { timeout: 45_000 },
        )
        .toBe(session.sessionId);
      await commands.recordNativePDFEvidence({ readingTimeReady: suspend, start });

      const waitForEvent = async (name: string) => {
        let match: { at: number } | undefined;
        await expect
          .poll(
            async () => {
              match = (await systemEvents(start)).find((event) => event.name === name);
              if (!match && name === suspend && Date.now() - start > 105_000) {
                const { intervals } = await send({ type: 'pause', session });
                await send({
                  type: 'ack',
                  ids: intervals
                    .filter((row) => row.sessionId === session.sessionId)
                    .map(({ id }) => id),
                });
                session = { ...session, sessionId: crypto.randomUUID() };
                start = Date.now();
                expect((await signal()).activeSessionId).toBe(session.sessionId);
              }
              return match;
            },
            {
              interval: 300,
              timeout: 480_000,
            },
          )
          .toBeDefined();
        return match!.at;
      };
      const suspended = await waitForEvent(suspend);
      const resumed = await waitForEvent(resume);
      const snapshot = await send({ type: 'status' });
      const rows = snapshot.intervals.filter(({ sessionId }) => sessionId === session.sessionId);
      const totalMs = rows.reduce((sum, row) => sum + row.durationMs, 0);
      const end = Math.max(...rows.map(({ startMs, durationMs }) => startMs + durationMs));
      await commands.recordNativePDFEvidence({
        suspend,
        resume,
        suspended,
        resumed,
        start,
        end,
        totalMs,
        activeAfterResume: snapshot.activeSessionId,
      });
      expect(suspended - start).toBeLessThan(118_000);
      expect(resumed - suspended).toBeGreaterThan(4_000);
      expect(totalMs).toBeGreaterThan(0);
      expect(end).toBeLessThanOrEqual(suspended + 1200);
      expect(snapshot.activeSessionId).toBeNull();

      // Sleep can end before the lock screen has been dismissed.
      await expect
        .poll(async () => (await signal()).activeSessionId, { timeout: 45_000 })
        .toBe(session.sessionId);
      // The lock screen can occlude the reader before the distributed lock
      // notification arrives. Report that difference independently of leakage.
      expect(end).toBeGreaterThanOrEqual(suspended - (suspend === 'locked' ? 15_000 : 3000));
      await send({ type: 'pause', session });
      const completed = (await send({ type: 'status' })).intervals;
      await send({
        type: 'ack',
        ids: completed.filter((row) => row.sessionId === session.sessionId).map(({ id }) => id),
      });
    } finally {
      await window.setVisibleOnAllWorkspaces(false);
      await window.setAlwaysOnTop(false);
    }
  },
  990_000,
);
