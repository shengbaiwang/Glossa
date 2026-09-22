import { mapWorkspaceSchema, type MapWorkspace } from './workspace';

export class MapStorageConflict extends Error {}

async function validateOrigins(workspace: MapWorkspace): Promise<void> {
  const origins = workspace.maps.flatMap((map) => [
    ...(map.origin ? [map.origin] : []),
    ...(map.extensions ?? []),
  ]);
  if (!origins.length) return;
  const { validateSavedMindmap } = await import('./store');
  const results = await Promise.all(origins.map(validateSavedMindmap));
  if (results.some((origin) => !origin)) throw new Error('Original map sources are invalid');
}

const open = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    let rejected = false;
    const request = indexedDB.open('glossa-map-workspaces', 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore('workspaces', { keyPath: 'bookId' });
    request.onsuccess = () => {
      if (rejected) request.result.close();
      else resolve(request.result);
    };
    request.onerror = request.onblocked = () => {
      rejected = true;
      reject(new Error('Map storage unavailable'));
    };
  });

export async function loadMapWorkspace(bookId: string): Promise<MapWorkspace> {
  const db = await open();
  try {
    const raw: unknown = await new Promise((resolve, reject) => {
      const tx = db.transaction('workspaces', 'readonly');
      const request = tx.objectStore('workspaces').get(bookId);
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = tx.onabort = () => reject(new Error('Map read failed'));
    });
    const workspace = mapWorkspaceSchema.parse(
      raw === undefined ? { version: 1, bookId, revision: 0, activeId: null, maps: [] } : raw,
    );
    if (workspace.bookId !== bookId) throw new Error('Map book mismatch');
    await validateOrigins(workspace);
    return workspace;
  } finally {
    db.close();
  }
}

/** Revision comparison and replacement share one transaction, including across windows. */
export async function saveMapWorkspace(workspace: MapWorkspace): Promise<void> {
  const valid = mapWorkspaceSchema.parse(workspace);
  await validateOrigins(valid);
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('workspaces', 'readwrite');
      const store = tx.objectStore('workspaces');
      const request = store.get(valid.bookId);
      let reason: Error | undefined;
      request.onsuccess = () => {
        const raw: unknown = request.result;
        const previous = raw === undefined ? null : mapWorkspaceSchema.safeParse(raw);
        if (
          (previous && !previous.success) ||
          (previous?.success ? previous.data.revision : 0) !== valid.revision
        ) {
          reason = new MapStorageConflict('Map changed in another window');
          tx.abort();
          return;
        }
        try {
          store.put({ ...valid, revision: valid.revision + 1 });
        } catch {
          reason = new Error('Map save failed');
          tx.abort();
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(reason ?? new Error('Map save failed'));
    });
  } finally {
    db.close();
  }
}
