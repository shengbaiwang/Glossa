import { useEffect, useSyncExternalStore } from 'react';
import { cleanMap, mapWorkspaceSchema, type MapWorkspace } from './workspace';
import { loadMapWorkspace, MapStorageConflict, saveMapWorkspace } from './workspaceStore';

type Snapshot = {
  data: MapWorkspace | null;
  status: 'loading' | 'ready' | 'saving' | 'error' | 'conflict';
  canUndo: boolean;
  canRedo: boolean;
};
type History = Pick<MapWorkspace, 'maps' | 'activeId'>;

class MapSession {
  snapshot: Snapshot = { data: null, status: 'loading', canUndo: false, canRedo: false };
  listeners = new Set<() => void>();
  past: History[] = [];
  future: History[] = [];
  private running = false;
  private change = 0;
  private persisted = 0;
  private loaded = false;
  private revision = 0;
  constructor(readonly bookId: string) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getSnapshot = () => this.snapshot;
  private publish(data: MapWorkspace | null, status: Snapshot['status']) {
    this.snapshot = {
      data,
      status,
      canUndo: this.past.length > 0,
      canRedo: this.future.length > 0,
    };
    for (const listener of this.listeners) listener();
  }
  load = async () => {
    if (this.loaded || this.running) return;
    this.running = true;
    this.publish(null, 'loading');
    try {
      const data = await loadMapWorkspace(this.bookId);
      this.revision = data.revision;
      this.loaded = true;
      this.publish(data, 'ready');
    } catch {
      this.publish(null, 'error');
    } finally {
      this.running = false;
    }
  };
  update = (transform: (data: MapWorkspace) => MapWorkspace, history = true) => {
    const current = this.snapshot.data;
    if (!current) return;
    const data = transform(current);
    if (JSON.stringify(current) === JSON.stringify(data)) return;
    if (!mapWorkspaceSchema.safeParse(data).success) return;
    if (history) {
      this.past = [...this.past.slice(-49), current];
      this.future = [];
    }
    this.change++;
    const blocked = this.snapshot.status === 'conflict';
    this.publish(data, blocked ? 'conflict' : 'saving');
    if (!blocked) void this.save();
  };
  undo = (redo = false) => {
    const data = this.snapshot.data;
    if (!data) return;
    const from = redo ? this.future : this.past;
    const to = redo ? this.past : this.future;
    const previous = from.pop();
    if (!previous) return;
    to.push(data);
    this.update(
      () => ({ ...data, ...previous, maps: previous.maps.map(cleanMap), revision: this.revision }),
      false,
    );
  };
  save = async () => {
    if (this.running || !this.loaded || this.snapshot.status === 'conflict') return;
    this.running = true;
    try {
      while (this.persisted !== this.change && this.snapshot.data) {
        const change = this.change;
        await saveMapWorkspace({ ...this.snapshot.data, revision: this.revision });
        this.revision++;
        this.persisted = change;
      }
      this.publish(this.snapshot.data, 'ready');
    } catch (error) {
      this.publish(this.snapshot.data, error instanceof MapStorageConflict ? 'conflict' : 'error');
    } finally {
      this.running = false;
    }
  };
}

// Shared per-book session serializes multiple panes and survives close/reopen and failed saves.
const sessions = new Map<string, MapSession>();
let unloadProtectionInstalled = false;
export function useMapWorkspace(bookId: string) {
  let session = sessions.get(bookId);
  if (!session) {
    session = new MapSession(bookId);
    sessions.set(bookId, session);
  }
  const snapshot = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot,
  );
  useEffect(() => {
    void session.load();
    if (!unloadProtectionInstalled) {
      unloadProtectionInstalled = true;
      window.addEventListener('beforeunload', (event) => {
        // Pending writes remain protected even after the reader pane has closed.
        if ([...sessions.values()].some((s) => s.snapshot.data && s.snapshot.status !== 'ready')) {
          event.preventDefault();
          event.returnValue = '';
        }
      });
    }
  }, [session]);
  return {
    ...snapshot,
    update: session.update,
    undo: session.undo,
    retry: snapshot.data ? session.save : session.load,
  };
}
