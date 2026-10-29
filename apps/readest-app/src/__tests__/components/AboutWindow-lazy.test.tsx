import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

const { loaded } = vi.hoisted(() => ({ loaded: vi.fn() }));
vi.mock('@/components/AboutContent', () => {
  loaded();
  return { default: () => <div>Deferred about contents</div> };
});
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (s: string) => s }));
vi.mock('@/components/Dialog', () => ({
  default: ({ id, isOpen, children }: { id: string; isOpen: boolean; children: ReactNode }) => (
    <div id={id}>{isOpen && children}</div>
  ),
}));

import { AboutWindow, setAboutDialogVisible } from '@/components/AboutWindow';
afterEach(cleanup);

it('keeps about content unloaded until its first explicit open', async () => {
  render(<AboutWindow />);
  expect(loaded).not.toHaveBeenCalled();
  act(() => setAboutDialogVisible(true));
  expect(await screen.findByText('Deferred about contents')).toBeTruthy();
  expect(loaded).toHaveBeenCalledTimes(1);
});
