import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import CustomFonts from '@/components/settings/CustomFonts';
import { useCustomFontStore } from '@/store/customFontStore';
import { DEFAULT_BOOK_FONT } from '@/services/constants';
import { saveViewSettings } from '@/helpers/settings';
import { mountCustomFont } from '@/styles/fonts';

const saved = {
  ...DEFAULT_BOOK_FONT,
  serifFont: 'My Reading Font',
  defaultCJKFont: 'My Reading Font',
};
const appService = { importFont: vi.fn(), deleteFont: vi.fn() };
const selectFiles = vi.fn();
const saveCustomFonts = vi.fn();
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService, envConfig: {} }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (text: string) => text }));
vi.mock('@/hooks/useFileSelector', () => ({ useFileSelector: () => ({ selectFiles }) }));
vi.mock('@/helpers/settings', () => ({ saveViewSettings: vi.fn() }));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({ getViewSettings: () => saved }),
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({ settings: { globalViewSettings: saved } }),
}));
vi.mock('@/services/sync/replicaPublish', () => ({
  publishReplicaDelete: vi.fn(),
  publishReplicaUpsert: vi.fn(),
}));
vi.mock('@/services/sync/replicaBinaryUpload', () => ({ queueReplicaBinaryUpload: vi.fn() }));
vi.mock('@/styles/fonts', async (original) => ({
  ...(await original<typeof import('@/styles/fonts')>()),
  mountCustomFont: vi.fn(),
}));

const font = {
  id: 'test-font',
  name: 'My Reading Font Regular',
  family: 'My Reading Font',
  path: 'reading.ttf',
  loaded: true,
};
beforeEach(() => {
  vi.clearAllMocks();
  appService.deleteFont.mockResolvedValue(undefined);
  appService.importFont.mockResolvedValue({ ...font, style: 'normal', weight: 400 });
  selectFiles.mockResolvedValue({ files: [{ path: '/selected/font.ttf' }] });
  useCustomFontStore.setState({
    fonts: [],
    saveCustomFonts,
    loadFont: async (_env, id) => {
      useCustomFontStore.getState().updateFont(id, { loaded: true, blobUrl: 'blob:test-font' });
      return useCustomFontStore.getState().getFont(id)!;
    },
  });
});
afterEach(cleanup);

describe('font import and removal', () => {
  it('imports a font and allows selecting it for reading', async () => {
    render(<CustomFonts bookKey='book' onBack={vi.fn()} />);
    fireEvent.click(screen.getByText('Import Font'));
    await waitFor(() => expect(saveCustomFonts).toHaveBeenCalled());
    expect(useCustomFontStore.getState().getFontFamilies()).toContain('My Reading Font');
    expect(mountCustomFont).toHaveBeenCalled();
    fireEvent.click(await screen.findByTitle('My Reading Font Regular'));
    expect(saveViewSettings).toHaveBeenCalledWith({}, 'book', 'serifFont', 'My Reading Font');
  });

  it('deletes an imported font and resets all selections using that family', async () => {
    useCustomFontStore.setState({ fonts: [font] });
    render(<CustomFonts bookKey='book' onBack={vi.fn()} />);
    fireEvent.click(screen.getByText('Delete'));
    fireEvent.click(screen.getByTitle('Delete Font'));
    await waitFor(() => expect(screen.queryByText('My Reading Font')).toBeNull());
    expect(appService.deleteFont).toHaveBeenCalledWith(font);
    expect(useCustomFontStore.getState().getFontFamilies()).not.toContain('My Reading Font');
    expect(saveViewSettings).toHaveBeenCalledWith({}, 'book', 'serifFont', 'Times New Roman');
    expect(saveViewSettings).toHaveBeenCalledWith({}, 'book', 'defaultCJKFont', 'Auto');
  });

  it('keeps the font available and reports a failed deletion', async () => {
    useCustomFontStore.setState({ fonts: [font] });
    appService.deleteFont.mockRejectedValue(new Error('disk error'));
    render(<CustomFonts bookKey='book' onBack={vi.fn()} />);
    fireEvent.click(screen.getByText('Delete'));
    fireEvent.click(screen.getByTitle('Delete Font'));
    expect((await screen.findByRole('alert')).textContent).toBe('Failed to delete font');
    expect(useCustomFontStore.getState().getFontFamilies()).toContain('My Reading Font');
    expect(saveViewSettings).not.toHaveBeenCalled();
  });

  it('reports an invalid font and allows trying another import', async () => {
    appService.importFont.mockRejectedValue(new Error('invalid font'));
    render(<CustomFonts bookKey='book' onBack={vi.fn()} />);
    fireEvent.click(screen.getByText('Import Font'));
    expect((await screen.findByRole('alert')).textContent).toBe('Failed to import font');
    expect((screen.getByText('Import Font').closest('button') as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect(useCustomFontStore.getState().getAllFonts()).toEqual([]);
  });

  it('handles cancelled imports without changing the library', async () => {
    selectFiles.mockResolvedValue({ files: [] });
    render(<CustomFonts bookKey='book' onBack={vi.fn()} />);
    fireEvent.click(screen.getByText('Import Font'));
    await waitFor(() => expect(selectFiles).toHaveBeenCalled());
    expect(appService.importFont).not.toHaveBeenCalled();
    expect(useCustomFontStore.getState().getAllFonts()).toEqual([]);
  });
});
