import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import BookItem from '@/app/library/components/BookItem';
import GroupItem from '@/app/library/components/GroupItem';
import type { Book } from '@/types/book';

vi.mock('next/navigation', () => ({ useRouter: () => ({}) }));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: {} }) }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/store/settingsStore', () => ({ useSettingsStore: () => ({ settings: {} }) }));
vi.mock('@/hooks/useMedianPageDurationSecs', () => ({
  useMedianPageDurationSecs: () => undefined,
}));

const book: Book = {
  hash: 'cached-narrow-cover',
  title: 'Cached cover',
  author: 'Glossa',
  format: 'EPUB',
  createdAt: 1,
  updatedAt: 1,
  coverImageUrl: 'asset://localhost/cached-cover.png',
};

function Card({ item, group }: { item: Book; group: boolean }) {
  return group ? (
    <GroupItem
      group={{
        id: 'cached-group',
        name: 'Cached',
        displayName: 'Cached',
        books: [item],
        updatedAt: 1,
      }}
      mode='grid'
      groupSelected={false}
    />
  ) : (
    <BookItem
      book={item}
      mode='grid'
      coverFit='fit'
      bookSelected={false}
      transferProgress={null}
      handleBookUpload={vi.fn()}
      handleBookDownload={vi.fn()}
      showBookDetailsModal={vi.fn()}
      showTimeRemaining={false}
    />
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it.each([
  false,
  true,
])('preserves cached image geometry in the real card owner (group=%s)', (group) => {
  // Exercise the real BookCover ref path when the native image is already complete.
  vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true);
  const width = vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(400);
  vi.spyOn(HTMLImageElement.prototype, 'naturalHeight', 'get').mockReturnValue(1000);
  const { container, rerender } = render(<Card item={book} group={group} />);
  const shell = container.querySelector<HTMLElement>('.bookitem-main, .groupitem-main')!;
  expect(Number.parseFloat(shell.style.width)).toBeCloseTo((0.4 / (28 / 41)) * 100);
  rerender(<Card item={{ ...book, progress: [2, 10], updatedAt: 2 }} group={group} />);
  expect(Number.parseFloat(shell.style.width)).toBeCloseTo((0.4 / (28 / 41)) * 100);
  width.mockReturnValue(600);
  rerender(<Card item={{ ...book, coverHash: 'replacement', coverUpdatedAt: 3 }} group={group} />);
  expect(Number.parseFloat(shell.style.width)).toBeCloseTo((0.6 / (28 / 41)) * 100);
  rerender(<Card item={{ ...book, coverImageUrl: undefined }} group={group} />);
  expect(shell.style.width).toBe(group ? '' : '100%');
  expect(shell.classList.contains('aspect-[28/41]')).toBe(true);
  expect(container.querySelector('img')).toBeNull();
});
