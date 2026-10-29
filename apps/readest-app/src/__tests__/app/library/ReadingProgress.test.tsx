import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import ReadingProgress from '@/app/library/components/ReadingProgress';
import type { Book } from '@/types/book';

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/hooks/useMedianPageDurationSecs', () => ({
  useMedianPageDurationSecs: () => undefined,
}));

afterEach(cleanup);

const book = {
  hash: 'status',
  title: 'Field Notes',
  author: 'An Author',
  format: 'EPUB',
  createdAt: 1,
  updatedAt: 1,
  progress: [1, 4],
} as Book;

it.each([
  undefined,
  'unread',
  'finished',
  'abandoned',
] as const)('hides percentage, time and %s status when progress is disabled', (readingStatus) => {
  const { container } = render(
    <ReadingProgress book={{ ...book, readingStatus }} showTimeRemaining showProgress={false} />,
  );
  expect(container.textContent).toBe('');
  expect(container.querySelector('[role="status"]')).toBeNull();
});

it('restores finished status and numeric progress when progress is enabled', () => {
  const { rerender } = render(
    <ReadingProgress book={{ ...book, readingStatus: 'finished' }} showTimeRemaining={false} />,
  );
  expect(screen.getByText('Finished')).toBeTruthy();
  rerender(<ReadingProgress book={book} showTimeRemaining={false} />);
  expect(screen.getByText('25%')).toBeTruthy();
});
