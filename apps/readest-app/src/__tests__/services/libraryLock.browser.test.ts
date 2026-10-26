import { expect, it, vi } from 'vitest';
import { withLibraryLock } from '@/services/libraryLock';

it('waits for a lock held outside the import module and recovers after a failed task', async () => {
  const prefix = '/cross-window-web-lock';
  let release!: () => void;
  let ready!: () => void;
  const acquired = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const external = navigator.locks.request(`glossa-library:${prefix}`, () => {
    ready();
    return new Promise<void>((resolve) => {
      release = resolve;
    });
  });
  await acquired;
  const task = vi.fn(async () => 'committed');
  const pending = withLibraryLock({ getPrefix: async () => prefix }, task);
  try {
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(task).not.toHaveBeenCalled();
  } finally {
    release();
    await external;
  }
  expect(await pending).toBe('committed');
  await expect(
    withLibraryLock({ getPrefix: async () => prefix }, async () => {
      throw new Error('save failed');
    }),
  ).rejects.toThrow('save failed');
  expect(await withLibraryLock({ getPrefix: async () => prefix }, async () => 'retry')).toBe(
    'retry',
  );
});

it('uses the shared database transaction when Web Locks is unavailable', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(navigator, 'locks');
  Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('glossa-library-locks', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('mutex');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  let hold = true;
  const transaction = db.transaction('mutex', 'readwrite');
  const completed = new Promise<void>((resolve) => {
    transaction.oncomplete = () => resolve();
  });
  const pulse = () => {
    const request = transaction.objectStore('mutex').get('external');
    request.onsuccess = () => {
      if (hold) pulse();
    };
  };
  pulse();
  const task = vi.fn(async () => 'safe');
  const pending = withLibraryLock({ getPrefix: async () => '/cross-window-idb' }, task);
  try {
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(task).not.toHaveBeenCalled();
    hold = false;
    await completed;
    expect(await pending).toBe('safe');
    await expect(
      withLibraryLock({ getPrefix: async () => '/cross-window-idb' }, async () => {
        throw new Error('save failed');
      }),
    ).rejects.toThrow('save failed');
    expect(
      await withLibraryLock({ getPrefix: async () => '/cross-window-idb' }, async () => 'retry'),
    ).toBe('retry');
  } finally {
    hold = false;
    db.close();
    if (descriptor) Object.defineProperty(navigator, 'locks', descriptor);
    else Reflect.deleteProperty(navigator, 'locks');
  }
});
