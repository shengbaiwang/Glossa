import { expect, it, vi } from 'vitest';
import { mapCheckpointStore, type MapCheckpoint } from '@/glossa/mindmap/checkpoints';

const signal = () => new AbortController().signal;
const key = () => crypto.randomUUID().replaceAll('-', '').repeat(2);
const fixture = (): MapCheckpoint => ({
  version: 1,
  contentHash: 'c'.repeat(64),
  sourceCount: 2,
  characterCount: 42,
  batches: [
    {
      start: 0,
      end: 1,
      points: [{ text: 'A condition constrains a conclusion.', sourceIds: ['s1'] }],
      elapsedMs: 1234,
    },
    { start: 1, end: 2 },
  ],
});
const open = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('glossa-map-generation', 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

it('restores a checkpoint through fresh database connections without duplicating original text', async () => {
  const id = key(),
    checkpoint = fixture();
  const revision = await mapCheckpointStore.save(id, null, checkpoint, signal());
  expect(await mapCheckpointStore.load(id)).toEqual({ revision, checkpoint });
  expect(JSON.stringify(checkpoint)).not.toContain('anchor');
});
it('restores bounded validation diagnostics and retry strategy through fresh database connections', async () => {
  const id = key(),
    checkpoint = fixture();
  checkpoint.skipDirect = true;
  checkpoint.promptOnly = true;
  checkpoint.batches[1]!.failure = {
    kind: 'structure',
    issues: [{ path: ['map', 'nodes', 1, 'label'], rule: 'too_big' }],
  };
  checkpoint.requests = [
    {
      phase: 'direct',
      batch: 1,
      elapsedMs: 100,
      outputBudget: 8192,
      outcome: 'invalid',
      diagnostic: checkpoint.batches[1]!.failure,
    },
  ];
  const revision = await mapCheckpointStore.save(id, null, checkpoint, signal());
  expect(await mapCheckpointStore.load(id)).toEqual({ revision, checkpoint });
  const untrusted = {
    ...checkpoint,
    failure: { kind: 'structure', issues: [{ path: ['PRIVATE_RESPONSE'], rule: 'too_big' }] },
  };
  await expect(
    mapCheckpointStore.save(id, revision, untrusted as MapCheckpoint, signal()),
  ).rejects.toThrow();
  expect(await mapCheckpointStore.load(id)).toEqual({ revision, checkpoint });
});
it('atomically rejects a stale writer across independent connections', async () => {
  const id = key();
  const revision = await mapCheckpointStore.save(id, null, fixture(), signal());
  const completed = fixture();
  completed.batches[1]!.points = [];
  await mapCheckpointStore.save(id, revision, completed, signal());
  await expect(mapCheckpointStore.save(id, revision, fixture(), signal())).rejects.toThrow(
    'another window',
  );
  expect((await mapCheckpointStore.load(id)).checkpoint).toEqual(completed);
});
it('ignores corrupted derived content while retaining a revision for safe replacement', async () => {
  const id = key(),
    checkpoint = fixture();
  const revision = await mapCheckpointStore.save(id, null, checkpoint, signal());
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('checkpoints', 'readwrite'),
      store = tx.objectStore('checkpoints');
    const read = store.get(id);
    read.onsuccess = () =>
      store.put({ ...read.result, checkpoint: { ...checkpoint, characterCount: 43 } });
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
  db.close();
  expect(await mapCheckpointStore.load(id)).toEqual({ revision, checkpoint: null });
  await mapCheckpointStore.save(id, revision, checkpoint, signal());
  expect((await mapCheckpointStore.load(id)).checkpoint).toEqual(checkpoint);
});
it('rolls back cancellation during a write and preserves the previous inventory', async () => {
  const id = key(),
    checkpoint = fixture(),
    controller = new AbortController();
  const revision = await mapCheckpointStore.save(id, null, checkpoint, signal());
  const original = IDBObjectStore.prototype.put;
  const intercepted = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
    this: IDBObjectStore,
    value: unknown,
    key?: IDBValidKey,
  ) {
    const request = original.call(this, value, key);
    queueMicrotask(() => controller.abort());
    return request;
  });
  try {
    const changed = fixture();
    changed.batches[1]!.points = [];
    await expect(
      mapCheckpointStore.save(id, revision, changed, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
  } finally {
    intercepted.mockRestore();
  }
  expect(await mapCheckpointStore.load(id)).toEqual({ revision, checkpoint });
});
it('bounds retained jobs without deleting any mind map workspace', async () => {
  const deleted = vi.spyOn(IDBFactory.prototype, 'deleteDatabase');
  const ids: string[] = [];
  try {
    for (let i = 0; i < 10; i++) {
      const id = key();
      ids.push(id);
      await mapCheckpointStore.save(id, null, fixture(), signal());
    }
    const db = await open();
    const count = await new Promise<number>((resolve) => {
      const read = db.transaction('checkpoints').objectStore('checkpoints').count();
      read.onsuccess = () => resolve(read.result);
    });
    db.close();
    expect(count).toBe(8);
    expect((await mapCheckpointStore.load(ids.at(-1)!)).checkpoint).not.toBeNull();
    expect(deleted).not.toHaveBeenCalled();
  } finally {
    deleted.mockRestore();
  }
});
it('rejects incomplete partitions or a finished map with unfinished inventories', async () => {
  const bad = fixture();
  bad.batches[1]!.start = 0;
  await expect(mapCheckpointStore.save(key(), null, bad, signal())).rejects.toThrow();
  const partial = fixture();
  partial.result = { nodes: [], insufficientEvidence: true };
  await expect(mapCheckpointStore.save(key(), null, partial, signal())).rejects.toThrow();
});
