import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  MigrateDataWindow,
  setMigrateDataDirDialogVisible,
} from '@/app/library/components/MigrateDataWindow';
import { registerLibraryDatabase } from '@/services/libraryRepository';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, options?: Record<string, string | number>) => {
    if (!options) return key;
    return key.replace(/{{(\w+)}}/g, (_match, name) => String(options[name] ?? ''));
  },
}));

const appService = {
  isAndroidApp: false,
  isDesktopApp: true,
  distChannel: 'github',
  resolveFilePath: vi.fn(async () => '/current/data/dir'),
  readDirectory: vi.fn(async () => []),
};
let envService: object = appService;

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: envService, envConfig: {} }),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({ settings: {}, setSettings: vi.fn(), saveSettings: vi.fn() }),
}));

vi.mock('@tauri-apps/api/path', () => ({
  documentDir: vi.fn(async () => '/docs'),
  join: vi.fn(async (...parts: string[]) => parts.join('/')),
}));
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: vi.fn() }));
vi.mock('@tauri-apps/plugin-opener', () => ({ revealItemInDir: vi.fn() }));
vi.mock('@/utils/bridge', () => ({ getExternalSDCardPath: vi.fn(async () => ({ path: '' })) }));
vi.mock('@/utils/permission', () => ({ requestStoragePermission: vi.fn(async () => true) }));

// Preserve the dialog id so the component's getElementById event wiring works.
vi.mock('@/components/Dialog', () => ({
  __esModule: true,
  default: ({
    id,
    title,
    children,
  }: {
    id?: string;
    title?: string;
    children: React.ReactNode;
  }) => (
    <div id={id} role='dialog' aria-label={title}>
      {children}
    </div>
  ),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  envService = appService;
});

describe('MigrateDataWindow e-ink button hierarchy', () => {
  it('uses btn-ghost (not btn-outline) for the Cancel button so it stays distinct from the primary CTA in e-ink', async () => {
    render(<MigrateDataWindow />);

    await act(async () => {
      setMigrateDataDirDialogVisible(true);
    });

    const cancelButton = await screen.findByRole('button', { name: 'Cancel' });
    const startButton = screen.getByRole('button', { name: 'Start Migration' });

    // The primary CTA keeps btn-primary, which e-ink inverts to a solid black fill.
    expect(startButton.className).toContain('btn-primary');

    // The Cancel button must NOT use btn-outline: in e-ink, btn-outline inverts
    // to the SAME solid black fill as btn-primary, leaving the two buttons
    // indistinguishable (see issue #4396). It must be a borderless ghost instead.
    expect(cancelButton.className).not.toContain('btn-outline');
    expect(cancelButton.className).toContain('btn-ghost');
  });

  it('keeps the current directory when a registered database backend has not created a file yet', async () => {
    const service = {
      ...appService,
      readDirectory: vi.fn(async () => [{ path: 'book.epub', size: 10 }]),
      selectDirectory: vi.fn(async () => '/new'),
      createDir: vi.fn(),
      copyFile: vi.fn(),
      deleteDir: vi.fn(),
      setCustomRootDir: vi.fn(),
    };
    const openDatabase = vi.fn();
    registerLibraryDatabase(service, openDatabase);
    envService = service;
    render(<MigrateDataWindow />);
    await act(async () => setMigrateDataDirDialogVisible(true));
    await waitFor(() => expect(service.readDirectory).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Choose New Folder' }));
    const start = screen.getByRole('button', { name: 'Start Migration' });
    await waitFor(() => expect((start as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(start);
    expect(
      await screen.findByText(
        'Changing this library’s data location is temporarily unsupported. Your current folder is kept.',
      ),
    ).not.toBeNull();
    expect(service.copyFile).not.toHaveBeenCalled();
    expect(service.deleteDir).not.toHaveBeenCalled();
    expect(service.setCustomRootDir).not.toHaveBeenCalled();
    expect(openDatabase).not.toHaveBeenCalled();
  });
});
