import { beforeEach, expect, it, vi } from 'vitest';
import { ReadingTimeClient } from '@/glossa/plugins/readingTime';
import type { AppService } from '@/types/system';

const { invoke, append, checkpoint } = vi.hoisted(() => ({
  invoke: vi.fn(),
  append: vi.fn(),
  checkpoint: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@/services/statistics/statisticsDb', () => ({
  StatisticsDb: { open: async () => ({ appendReadingIntervals: append, checkpoint }) },
}));

const session = { bookHash: 'book-a', sessionId: 'session-a' };
const interval = { ...session, id: 'session-a:1', startMs: 1000, durationMs: 9000 };
const ack = ['reading_time', { activity: { type: 'ack', ids: [interval.id] } }];

beforeEach(() => {
  vi.resetAllMocks();
  invoke.mockImplementation(async (_command, { activity }) => ({
    activeSessionId: null,
    intervals: activity.type === 'ack' ? [] : [interval],
  }));
});

it('keeps an interval unacknowledged on a failed write and retries with the same ID', async () => {
  append.mockRejectedValueOnce(new Error('disk busy'));
  const client = new ReadingTimeClient({} as AppService);
  await client.pause(session);
  expect(client.getSnapshot().error).toBe(true);
  expect(invoke).not.toHaveBeenCalledWith(...ack);

  await client.refresh();
  expect(append.mock.calls).toEqual([[[interval]], [[interval]]]);
  expect(invoke).toHaveBeenLastCalledWith(...ack);
  expect(client.getSnapshot().error).toBe(false);
});

it('sends the pause to the native clock even when an earlier write is pending', async () => {
  const client = new ReadingTimeClient({} as AppService);
  let release: () => void = () => {};
  append.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const first = client.refresh();
  await vi.waitFor(() => expect(append).toHaveBeenCalledTimes(1));
  const second = client.pause(session);
  expect(invoke).toHaveBeenLastCalledWith('reading_time', {
    activity: { type: 'pause', session },
  });
  release();
  await Promise.all([first, second]);
  expect(checkpoint).toHaveBeenCalledTimes(1);
});
