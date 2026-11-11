import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { StatisticsDb } from '@/services/statistics/statisticsDb';
import type { ReadingInterval } from '@/types/statistics';
import type { AppService } from '@/types/system';

export interface ReadingSession {
  sessionId: string;
  bookHash: string;
}

export type ReadingActivity = 'turn' | 'scroll' | 'selection' | 'lookup' | 'highlight' | 'note';

type Action =
  | { type: 'signal'; session: ReadingSession; kind: ReadingActivity }
  | { type: 'pause'; session?: ReadingSession }
  | { type: 'disable' | 'enable' }
  | { type: 'status' }
  | { type: 'ack'; ids: string[] };

interface Snapshot {
  activeSessionId: string | null;
  intervals: ReadingInterval[];
}

export const emptyStatus = {
  activeSessionId: null as string | null,
  error: false,
};

export class ReadingTimeClient {
  private status = emptyStatus;
  private writes: Promise<void> = Promise.resolve();
  private pendingCheckpoint = false;
  private observer: Promise<() => void> | undefined;
  private generation = 0;
  private running = false;

  constructor(private readonly app: AppService) {}

  getSnapshot = () => this.status;
  private publish(update: Partial<typeof emptyStatus>) {
    this.status = { ...this.status, ...update };
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.observer = listen('reading-time-flush', () => void this.refresh());
    void this.observer.catch(() => this.publish({ error: true }));
  }

  stop() {
    this.running = false;
    this.generation++;
    void this.observer?.then((unlisten) => unlisten()).catch(() => {});
    this.observer = undefined;
    return this.request({ type: 'pause' });
  }

  signal(session: ReadingSession, kind: ReadingActivity) {
    if (this.running) void this.request({ type: 'signal', session, kind });
  }

  pause(session?: ReadingSession) {
    return this.request({ type: 'pause', session });
  }

  setEnabled(enabled: boolean) {
    return this.request({ type: enabled ? 'enable' : 'disable' });
  }

  refresh() {
    return this.request({ type: 'status' });
  }

  private request(action: Action): Promise<void> {
    // Invoke immediately so a slow write cannot delay a pause or a book switch.
    const generation = this.generation;
    const response = invoke<Snapshot>('reading_time', { activity: action });
    void response.catch(() => {});
    const persist = async () => {
      try {
        let snapshot = await response;
        if (generation === this.generation) {
          this.publish({ activeSessionId: snapshot.activeSessionId });
        }
        if (snapshot.intervals.length || this.pendingCheckpoint) {
          const db = await StatisticsDb.open(this.app);
          while (snapshot.intervals.length) {
            const intervals = snapshot.intervals;
            await db.appendReadingIntervals(intervals);
            snapshot = await invoke<Snapshot>('reading_time', {
              activity: { type: 'ack', ids: intervals.map(({ id }) => id) },
            });
          }
          if (this.pendingCheckpoint || action.type === 'pause' || action.type === 'disable') {
            this.pendingCheckpoint = true;
            await db.checkpoint();
            this.pendingCheckpoint = false;
          }
        }
        if (!this.pendingCheckpoint) this.publish({ error: false });
      } catch {
        this.publish({ error: true });
      }
    };
    this.writes = this.writes.then(persist);
    return this.writes;
  }
}

let client: ReadingTimeClient | undefined;
export function getReadingTimeClient(app: AppService) {
  return (client ??= new ReadingTimeClient(app));
}
