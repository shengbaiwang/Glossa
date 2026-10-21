import { useEffect } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Book } from '@/types/book';
import type { BookDoc } from '@/libs/document';
import type { SystemSettings } from '@/types/settings';
import { useSettingsStore } from '@/store/settingsStore';
import OfficialModulePanel from '@/glossa/modules/OfficialModulePanel';

const f = vi.hoisted(() => ({
  imports: vi.fn(),
  signals: [] as AbortSignal[],
  event: vi.fn(),
  fail: false,
}));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/glossa/ui/ConversationPanel', () => {
  f.imports('conversation');
  return {
    default: () => {
      useEffect(() => {
        const controller = new AbortController();
        f.signals.push(controller.signal);
        window.addEventListener('module-fixture', f.event);
        return () => {
          controller.abort();
          window.removeEventListener('module-fixture', f.event);
        };
      }, []);
      if (f.fail) throw new Error('Private module failure');
      return <p>Conversation ready</p>;
    },
  };
});
vi.mock('@/glossa/ui/MindmapPanel', () => {
  f.imports('mindmap');
  return { default: () => <p>Mind map ready</p> };
});
const book = { hash: 'original-module-fixture', format: 'EPUB' } as Book;
const bookDoc = { toc: [] } as unknown as BookDoc;
const props = { book, bookDoc, bookKey: 'original-module-fixture-1' };
const disable = (disabled: boolean) =>
  act(() =>
    useSettingsStore.setState({
      settings: { officialModules: { conversation: !disabled } } as SystemSettings,
    }),
  );
beforeEach(() => {
  f.fail = false;
  f.event.mockClear();
  useSettingsStore.setState({ settings: {} as SystemSettings });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('imports only an enabled, supported module and releases active resources on disable', async () => {
  disable(true);
  const importsBefore = f.imports.mock.calls.length;
  const signalsBefore = f.signals.length;
  const view = render(<OfficialModulePanel {...props} moduleId='conversation' />);
  expect(view.container.textContent).toBe('');
  expect(f.imports).toHaveBeenCalledTimes(importsBefore);
  disable(false);
  expect(await screen.findByText('Conversation ready')).toBeTruthy();
  expect(f.imports).toHaveBeenCalledWith('conversation');
  expect(f.imports).not.toHaveBeenCalledWith('mindmap');
  const signal = f.signals[signalsBefore]!;
  expect(signal.aborted).toBe(false);
  window.dispatchEvent(new Event('module-fixture'));
  expect(f.event).toHaveBeenCalledOnce();
  disable(true);
  expect(signal.aborted).toBe(true);
  expect(screen.queryByText('Conversation ready')).toBeNull();
  window.dispatchEvent(new Event('module-fixture'));
  expect(f.event).toHaveBeenCalledOnce();
  disable(false);
  expect(await screen.findByText('Conversation ready')).toBeTruthy();
  expect(f.signals.at(-1)?.aborted).toBe(false);
  view.rerender(
    <OfficialModulePanel {...props} book={{ ...book, format: 'PDF' }} moduleId='mindmap' />,
  );
  expect(f.signals.at(-1)?.aborted).toBe(true);
  expect(f.imports).not.toHaveBeenCalledWith('mindmap');
});

it('isolates a failed module, keeps the reading core mounted and allows explicit retry', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  f.fail = true;
  const readingCleanup = vi.fn();
  function ReadingCore() {
    useEffect(() => readingCleanup, []);
    return <p>Reading and notes</p>;
  }
  render(
    <>
      <ReadingCore />
      <OfficialModulePanel {...props} moduleId='conversation' />
    </>,
  );
  expect(await screen.findByRole('alert')).toHaveProperty(
    'textContent',
    expect.stringContaining('This module could not be opened.'),
  );
  expect(screen.queryByText('Private module failure')).toBeNull();
  expect(screen.getByText('Reading and notes')).toBeTruthy();
  expect(readingCleanup).not.toHaveBeenCalled();
  f.fail = false;
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('Conversation ready')).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
});
