import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import ReadingDisplayControls from '@/components/settings/ReadingDisplayControls';
import { saveViewSettings } from '@/helpers/settings';

const fixture = vi.hoisted(() => ({
  settings: { scrolled: false, zoomLevel: 100, zoomMode: 'fit-page', spreadMode: 'auto' },
  renderer: { setAttribute: vi.fn() },
}));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {}, appService: {} }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/hooks/useResponsiveSize', () => ({ useResponsiveSize: (size: number) => size }));
vi.mock('@/helpers/settings', () => ({ saveViewSettings: vi.fn() }));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    getViewSettings: () => fixture.settings,
    getView: () => ({ renderer: fixture.renderer }),
    setViewSettings: vi.fn(),
  }),
}));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({
    getBookData: () => ({ bookDoc: { rendition: { layout: 'pre-paginated' } } }),
  }),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it('opening PDF display controls does not persist optional defaults or touch the renderer', async () => {
  render(<ReadingDisplayControls bookKey='pdf' onRegisterReset={vi.fn()} />);
  await waitFor(() =>
    expect(document.querySelector('.glossa-reading-display-controls')).not.toBeNull(),
  );
  expect(saveViewSettings).not.toHaveBeenCalled();
  expect(fixture.renderer.setAttribute).not.toHaveBeenCalled();
});
