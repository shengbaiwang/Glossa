import { afterEach, expect, test, vi } from 'vitest';
import { render, cleanup, screen, within } from '@testing-library/react';
import { userEvent } from 'vitest/browser';
import { z } from 'zod';
import LegacyBookCaches from '@/components/LegacyBookCaches';
import { createDerivedStore } from '@/glossa/harness/derivedStore';
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation:
    () =>
    (key: string, values: Record<string, unknown> = {}) =>
      key.replace(/{{(\w+)}}/g, (_, name: string) => String(values[name] ?? name)),
}));
afterEach(async () => {
  cleanup();
  for (const name of ['glossa-reading-inventories', 'glossa-book-data-lifecycle'])
    await new Promise<void>((resolve, reject) => {
      const r = indexedDB.deleteDatabase(name);
      r.onsuccess = () => resolve();
      r.onerror = () => reject(r.error);
    });
});
test('confirms a fixed preview, preserves later rows and owned data, and detects changed shared content', async () => {
  const cache = createDerivedStore('glossa-reading-inventories', z.array(z.string()));
  const signal = new AbortController().signal;
  await cache.save('a'.repeat(64), ['reviewed'], signal);
  await cache.save('b'.repeat(64), ['owned'], signal, { bookId: 'other-book', revision: 0 });
  render(<LegacyBookCaches />);
  await userEvent.click(screen.getByRole('button', { name: 'Check legacy shared data' }));
  let dialog = await screen.findByRole('alertdialog');
  expect(within(dialog).getByText('Shared generated cache rows: 1')).toBeTruthy();
  expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Cancel' }));
  await userEvent.keyboard('{Escape}');
  expect(await cache.load('a'.repeat(64))).toEqual(['reviewed']);
  await userEvent.click(screen.getByRole('button', { name: 'Check legacy shared data' }));
  dialog = await screen.findByRole('alertdialog');
  await cache.save('c'.repeat(64), ['later'], signal);
  await userEvent.click(within(dialog).getByRole('button', { name: 'Clear reviewed data' }));
  await screen.findByText('Reviewed legacy shared data cleared.');
  expect(await cache.load('a'.repeat(64))).toBeNull();
  expect(await cache.load('b'.repeat(64))).toEqual(['owned']);
  expect(await cache.load('c'.repeat(64))).toEqual(['later']);
  await userEvent.click(screen.getByRole('button', { name: 'Check legacy shared data' }));
  dialog = await screen.findByRole('alertdialog');
  await cache.save('c'.repeat(64), ['changed'], signal);
  await userEvent.click(within(dialog).getByRole('button', { name: 'Clear reviewed data' }));
  await screen.findByText('Shared data changed or cleanup failed. Check it again before retrying.');
  expect(await cache.load('c'.repeat(64))).toEqual(['changed']);
});
