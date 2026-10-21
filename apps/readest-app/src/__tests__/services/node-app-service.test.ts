import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { NodeAppService } from '@/services/nodeAppService';
import type { Book } from '@/types/book';
import { fsTests } from './suites/fs-tests';
import { libraryTests } from './suites/library-tests';
import { bookTests } from './suites/book-tests';

const FIXTURES_DIR = path.join(process.cwd(), 'src/__tests__/fixtures/data');

async function getBookFile(name: string): Promise<File> {
  const buf = await fsp.readFile(path.join(FIXTURES_DIR, name));
  return new File([buf], name);
}

const SANDBOX_DIR = path.join(process.cwd(), '.test-sandbox-node');

describe('NodeAppService', () => {
  let tmpDir: string;
  let service: NodeAppService;

  beforeAll(async () => {
    await fsp.mkdir(SANDBOX_DIR, { recursive: true });
  });

  afterAll(async () => {
    await fsp.rm(SANDBOX_DIR, { recursive: true, force: true });
  });

  beforeEach(async () => {
    tmpDir = await fsp.mkdtemp(path.join(SANDBOX_DIR, 'node-'));
    service = new NodeAppService(tmpDir);
    await service.init();
  });

  afterEach(async () => {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  });

  it('imports an original PDF with software metadata, saves the corrected title, and reopens identical bytes', async () => {
    await import('foliate-js/pdf.js');
    const pdfjs = (
      globalThis as unknown as {
        pdfjsLib: { GlobalWorkerOptions: { workerSrc: string } };
      }
    ).pdfjsLib;
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      `file://${path.join(process.cwd(), 'public/vendor/pdfjs/pdf.worker.min.mjs')}`,
    ).href;
    // Original one-page fixture; offsets are ASCII byte offsets.
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << >> /Contents 4 0 R >>',
      '<< /Length 0 >>\nstream\n\nendstream',
      '<< /Title (ssreader) /Author (ssreader) >>',
    ];
    let pdf = '%PDF-1.4\n';
    const offsets = [0];
    for (const [i, object] of objects.entries()) {
      offsets.push(pdf.length);
      pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
    }
    const xref = pdf.length;
    pdf += `xref\n0 6\n0000000000 65535 f \n`;
    for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
    pdf += `trailer\n<< /Size 6 /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF`;
    const file = new File([pdf], '原创导入样本.pdf', { type: 'application/pdf' });
    const books: Book[] = [];
    const imported = await service.importBook(file, books, { saveCover: false });
    expect(imported?.title).toBe('原创导入样本');
    expect(imported?.author).toBe('');
    expect(imported?.metadata).toMatchObject({ title: 'ssreader', author: 'ssreader' });
    await service.saveLibraryBooks(books);
    const [restored] = await service.loadLibraryBooks();
    expect(restored?.title).toBe('原创导入样本');
    expect(restored?.author).toBe('');
    expect(restored?.hash).toBe(imported?.hash);
    const reopened = await service.loadBookContent(restored!);
    expect(await reopened.file.arrayBuffer()).toEqual(await file.arrayBuffer());
  }, 30_000);

  it('should copy files from absolute path', async () => {
    const srcPath = path.join(tmpDir, 'source.txt');
    await fsp.writeFile(srcPath, 'copy me');
    await service.copyFile(srcPath, 'None', 'copied.txt', 'Data');
    const content = await service.readFile('copied.txt', 'Data', 'text');
    expect(content).toBe('copy me');
  });

  it('should save files via saveFile', async () => {
    const filepath = path.join(tmpDir, 'saved.txt');
    const result = await service.saveFile('saved.txt', 'saved content', { filePath: filepath });
    expect(result).toBe(true);
    const content = await fsp.readFile(filepath, 'utf-8');
    expect(content).toBe('saved content');
  });

  it('should set localBooksDir after init', () => {
    expect(service.localBooksDir).toBe(path.join(tmpDir, 'Readest', 'Books'));
  });

  it('should resolve file paths correctly', async () => {
    const resolved = await service.resolveFilePath('test.json', 'Books');
    expect(resolved).toBe(path.join(tmpDir, 'Readest', 'Books', 'test.json'));
  });

  it('should resolve empty path to prefix', async () => {
    const resolved = await service.resolveFilePath('', 'Data');
    expect(resolved).toBe(path.join(tmpDir, 'Readest'));
  });

  it('should switch to new root via setCustomRootDir', async () => {
    const newRoot = await fsp.mkdtemp(path.join(SANDBOX_DIR, 'custom-'));
    try {
      await service.setCustomRootDir(newRoot);
      expect(service.localBooksDir).toBe(path.join(newRoot, 'Readest', 'Books'));
      await service.writeFile('test.txt', 'Settings', 'settings data');
      const content = await service.readFile('test.txt', 'Settings', 'text');
      expect(content).toBe('settings data');
    } finally {
      await fsp.rm(newRoot, { recursive: true, force: true });
    }
  });

  it('should use system dirs when no customRootDir', async () => {
    const defaultService = new NodeAppService();
    const settingsPrefix = await defaultService.resolveFilePath('', 'Settings');
    expect(settingsPrefix).toBeTruthy();
    expect(path.isAbsolute(settingsPrefix)).toBe(true);
    expect(settingsPrefix.toLowerCase()).toContain('readest');
  });

  fsTests(() => service);
  libraryTests(() => service);
  bookTests(() => service, getBookFile);
});
