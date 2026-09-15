import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useState } from 'react';
import SearchOptions from '@/app/reader/components/sidebar/SearchOptions';
import type { BookSearchConfig } from '@/types/book';

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
afterEach(cleanup);

function Menu() {
  const [config, setConfig] = useState<BookSearchConfig>({
    scope: 'book',
    mode: 'contains',
    matchCase: false,
    matchDiacritics: false,
  });
  return <SearchOptions isEink={false} searchConfig={config} onSearchConfigChanged={setConfig} />;
}

it('offers one exclusive mode group and independent switches in a single menu', () => {
  render(<Menu />);
  const trigger = screen.getByRole('button', { name: 'Search Options' });
  fireEvent.keyDown(trigger, { key: 'Enter' });
  expect(screen.getAllByRole('menuitemradio')).toHaveLength(4);
  expect(screen.queryByRole('menuitemcheckbox', { name: 'Whole Words' })).toBeNull();
  expect(screen.queryByText('Advanced search')).toBeNull();
  fireEvent.click(screen.getByRole('menuitemradio', { name: 'Whole word' }));
  expect(trigger.textContent).toBe('Options');
  expect(
    screen.getByRole('menuitemradio', { name: 'Whole word' }).getAttribute('aria-checked'),
  ).toBe('true');
  fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Match Case' }));
  fireEvent.click(screen.getByRole('menuitemradio', { name: 'Regex' }));
  expect(
    screen.getByRole('menuitemcheckbox', { name: 'Match Case' }).getAttribute('aria-checked'),
  ).toBe('true');
  expect(
    screen
      .getByRole('menuitemcheckbox', { name: 'Match Diacritics' })
      .hasAttribute('data-disabled'),
  ).toBe(true);
  fireEvent.click(screen.getByRole('menuitem', { name: 'Reset search options' }));
  fireEvent.keyDown(screen.getByRole('button', { name: 'Search Options' }), { key: 'Enter' });
  expect(screen.getByRole('menuitemradio', { name: 'Normal' }).getAttribute('aria-checked')).toBe(
    'true',
  );
  expect(
    screen.getByRole('menuitemcheckbox', { name: 'Match Case' }).getAttribute('aria-checked'),
  ).toBe('false');
  expect(screen.queryByRole('menuitem', { name: 'Reset search options' })).toBeNull();
});
