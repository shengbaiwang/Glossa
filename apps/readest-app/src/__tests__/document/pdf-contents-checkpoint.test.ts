import { beforeEach, expect, it, vi } from 'vitest';
import { pdfContentsCheckpointStorage } from '@/services/pdfContentsCheckpoint';
vi.mock('@/services/bookDataLifecycle', () => ({
  withBookDataWrite: async (_id: string, _revision: number, fn: () => Promise<unknown>) => fn(),
}));
const files = new Map<string, string>();
const host = {
  exists: async (path: string) => files.has(path),
  readFile: vi.fn(async (path: string) => {
    if (!files.has(path)) throw new Error('missing');
    return files.get(path)!;
  }),
  writeFile: vi.fn(async (path: string, _base: string, raw: unknown) => {
    files.set(path, String(raw));
  }),
  deleteFile: vi.fn(async (path: string) => {
    files.delete(path);
  }),
  fs: {
    moveFile: vi.fn(async (source: string, _base: string, target: string) => {
      if (!files.has(source)) throw new Error('missing');
      files.set(target, files.get(source)!);
      files.delete(source);
    }),
    getPrefix: async () => 'checkpoint-test',
  },
};
beforeEach(() => {
  files.clear();
  vi.clearAllMocks();
});
it('does not reset the quota ledger when an existing ledger cannot be read', async () => {
  const storage = pdfContentsCheckpointStorage(host, { bookId: 'book', revision: 0 })!;
  await storage.write({ old: true });
  const before = new Map(files);
  const read = host.readFile.getMockImplementation()!;
  host.readFile.mockImplementation(async (path) => {
    if (path === 'pdf-contents-cache-index.json') throw new Error('read failure');
    return read(path);
  });
  try {
    await expect(storage.write({ next: true })).rejects.toThrow('read failure');
    expect(files).toEqual(before);
  } finally {
    host.readFile.mockImplementation(read);
  }
});
it('round trips a large Unicode checkpoint in bounded verified parts', async () => {
  const storage = pdfContentsCheckpointStorage(host, { bookId: 'book', revision: 0 })!;
  const checkpoint = { key: 'a'.repeat(64), checks: { text: '章节😀'.repeat(150000) } };
  await storage.write(checkpoint);
  expect(await storage.read()).toEqual(checkpoint);
  expect([...files.values()].every((raw) => new TextEncoder().encode(raw).length <= 320000)).toBe(
    true,
  );
});
it('keeps the previous committed generation when manifest replacement fails', async () => {
  const storage = pdfContentsCheckpointStorage(host, { bookId: 'book', revision: 0 })!;
  await storage.write({ old: true });
  const move = host.fs.moveFile.getMockImplementation()!;
  host.fs.moveFile.mockImplementation(async (source, base, target) => {
    if (target === 'book/pdf-contents-checkpoint.json') throw new Error('disk failure');
    return move(source, base, target);
  });
  try {
    await expect(storage.write({ next: '字'.repeat(200000) })).rejects.toThrow('disk failure');
  } finally {
    host.fs.moveFile.mockImplementation(move);
  }
  expect(await storage.read()).toEqual({ old: true });
});
it.each([
  false,
  true,
])('evicts only inactive checkpoints at the shared quota (active: %s)', async (active) => {
  const part = { hash: 'b'.repeat(64), bytes: 320000 };
  const victims = Array.from({ length: 5 }, (_, i) => ({
    bookId: `old-${i}`,
    parts: Array.from({ length: 42 }, () => part),
    touched: i,
    activeUntil: active ? Date.now() + 240000 : 0,
  }));
  files.set('pdf-contents-cache-index.json', JSON.stringify(victims));
  files.set('old-0/pdf-contents-checkpoint.json', 'old');
  files.set('old-0/notes.json', 'personal');
  const storage = pdfContentsCheckpointStorage(host, { bookId: 'book', revision: 0 })!;
  if (active) {
    await expect(storage.write({ text: 'a'.repeat(200000) })).rejects.toThrow(
      'pdf_contents_checkpoint_limit',
    );
    expect(host.deleteFile).not.toHaveBeenCalled();
  } else {
    await storage.write({ text: 'a'.repeat(200000) });
    expect(files.has('old-0/pdf-contents-checkpoint.json')).toBe(false);
    expect(await storage.read()).toEqual({ text: 'a'.repeat(200000) });
  }
  expect(files.get('old-0/notes.json')).toBe('personal');
});
it('rejects corrupt parts and respects the deletion generation', async () => {
  const storage = pdfContentsCheckpointStorage(host, { bookId: 'book', revision: 0 })!;
  await storage.write({ text: '字'.repeat(200000) });
  expect(
    await pdfContentsCheckpointStorage(host, { bookId: 'book', revision: 1 })!.read(),
  ).toBeNull();
  const part = [...files.keys()].find((path) => path.includes('pdf-contents-part-'))!;
  expect(part).toBeTruthy();
  files.set(part, 'corrupt');
  expect(await storage.read()).toBeNull();
});
it('reads legacy inline checkpoints without rewriting personal data', async () => {
  files.set(
    'book/pdf-contents-checkpoint.json',
    JSON.stringify({ generation: 0, checkpoint: { old: true } }),
  );
  expect(await pdfContentsCheckpointStorage(host, { bookId: 'book', revision: 0 })!.read()).toEqual(
    { old: true },
  );
  expect(host.writeFile).not.toHaveBeenCalled();
});
it('keeps undeleted old parts reserved after a successful manifest replacement', async () => {
  const storage = pdfContentsCheckpointStorage(host, { bookId: 'book', revision: 0 })!;
  await storage.write({ old: true });
  const oldPart = [...files.keys()].find((path) => path.includes('pdf-contents-part-'))!;
  host.deleteFile.mockImplementationOnce(async (path) => {
    if (path.endsWith('.tmp')) files.delete(path);
  });
  const remove = host.deleteFile.getMockImplementation()!;
  host.deleteFile.mockImplementation(async (path) => {
    if (path === oldPart) throw new Error('locked');
    files.delete(path);
  });
  try {
    await storage.write({ next: true });
    const ledger = JSON.parse(files.get('pdf-contents-cache-index.json')!);
    expect(ledger[0].parts).toHaveLength(2);
    expect(await storage.read()).toEqual({ next: true });
  } finally {
    host.deleteFile.mockImplementation(remove);
  }
});
it('rejects an oversized checkpoint before touching a committed manifest', async () => {
  const storage = pdfContentsCheckpointStorage(host, { bookId: 'book', revision: 0 })!;
  await storage.write({ old: true });
  await expect(storage.write({ text: '字'.repeat(6000000) })).rejects.toThrow(
    'pdf_contents_checkpoint_limit',
  );
  expect(await storage.read()).toEqual({ old: true });
});
