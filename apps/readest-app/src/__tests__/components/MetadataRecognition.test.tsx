import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Book } from '@/types/book';
import MetadataRecognition from '@/components/metadata/MetadataRecognition';

const mocks = vi.hoisted(() => ({
  run: vi.fn(),
  load: vi.fn(),
  save: vi.fn(),
  verify: vi.fn(async () => 'a'.repeat(64)),
  apply: vi.fn(async () => true),
  navigate: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/utils/nav', () => ({ navigateToReader: mocks.navigate }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (s: string) => s }));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {} }) }));
vi.mock('@/glossa/plugins/metadataRecognition', () => ({ runBookMetadataRecognition: mocks.run }));
vi.mock('@/glossa/metadata/storage', () => ({
  loadMetadataRecognition: mocks.load,
  saveMetadataRecognition: mocks.save,
}));
vi.mock('@/glossa/metadata/recognize', () => ({ verifyMetadataSource: mocks.verify }));
vi.mock('@/store/settingsStore', () => ({ useSettingsStore: () => ({ settings: {} }) }));
const book: Book = {
  hash: 'book',
  title: 'original-file',
  originalFilename: 'original-file.epub',
  author: 'Personal',
  format: 'EPUB',
  createdAt: 1,
  updatedAt: 1,
  contentFingerprint: 'a'.repeat(64),
};
const recognition = {
  version: 1 as const,
  fingerprint: book.contentFingerprint!,
  complete: true,
  candidates: [
    {
      id: 'title',
      field: 'title' as const,
      value: 'Formal title',
      confidence: 'supported' as const,
      source: { kind: 'file' as const, label: 'File metadata', excerpt: 'Formal title' },
    },
    {
      id: 'publisher',
      field: 'publisher' as const,
      value: 'Local Press',
      confidence: 'supported' as const,
      source: {
        kind: 'text' as const,
        label: 'Copyright page',
        excerpt: 'Publisher: Local Press',
        pageIndex: 3,
      },
    },
  ],
};
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it('opens cached candidates without starting recognition and applies only explicitly selected fields', async () => {
  mocks.load.mockResolvedValue(recognition);
  render(<MetadataRecognition book={book} onApply={mocks.apply} />);
  await screen.findByText('Local Press');
  expect(mocks.run).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Fill empty fields' }));
  await waitFor(() => expect(mocks.apply).toHaveBeenCalledWith(book, { publisher: 'Local Press' }));
  expect(mocks.verify).toHaveBeenCalled();
  expect(book.title).toBe('original-file');
});
it('keeps failed candidates available for retry and displays literal evidence inline', async () => {
  mocks.load.mockResolvedValue(recognition);
  mocks.apply.mockResolvedValueOnce(false);
  render(<MetadataRecognition book={book} onApply={mocks.apply} />);
  await screen.findByText('Local Press');
  fireEvent.click(screen.getAllByText('Show evidence')[1]!);
  expect(screen.getByText('Publisher: Local Press')).toBeTruthy();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Fill empty fields' }));
  });
  expect(screen.getByText('Failed to save changes')).toBeTruthy();
  expect(screen.getByText('Local Press')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Fill empty fields' }));
  await waitFor(() => expect(mocks.apply).toHaveBeenCalledTimes(2));
});

it('refuses a cached evidence link if a legacy file changed since recognition', async () => {
  mocks.load.mockResolvedValue(recognition);
  mocks.verify.mockResolvedValueOnce('b'.repeat(64));
  render(
    <MetadataRecognition book={{ ...book, contentFingerprint: undefined }} onApply={mocks.apply} />,
  );
  await screen.findByText('Local Press');
  fireEvent.click(screen.getAllByText('Show evidence')[1]!);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'View source' }));
  });
  expect(mocks.navigate).not.toHaveBeenCalled();
  expect(screen.getByRole('alert').textContent).toContain('Source changed or unavailable');
});
