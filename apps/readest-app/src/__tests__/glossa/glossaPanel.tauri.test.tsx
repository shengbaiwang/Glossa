import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: null }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (text: string) => text }));
vi.mock('@/hooks/useSwipeToDismiss', () => ({
  useSwipeToDismiss: () => ({
    panelRef: { current: null },
    overlayRef: { current: null },
    panelHeight: { current: 1 },
    handleVerticalDragStart: vi.fn(),
  }),
}));
vi.mock('@/hooks/usePanelResize', () => ({
  usePanelResize: () => ({ handleResizeStart: vi.fn(), handleResizeKeyDown: vi.fn() }),
}));

import GlossaPanel from '@/glossa/ui/GlossaPanel';
import { createContextPack } from '@/glossa/context/contextPack';
import { useGlossaPanelStore } from '@/glossa/ui/glossaPanelStore';

const env = process.env as Record<string, string | undefined>;
const flagName = 'NEXT_PUBLIC_GLOSSA_ENABLED';
const originalFlag = env[flagName];

let host: HTMLDivElement;
let root: Root;

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

beforeEach(() => {
  env[flagName] = 'true';
  const selection = {
    text: 'records every amber mark',
    anchor: {
      version: 1 as const,
      documentId: 'glossa-reading-sample-tauri',
      format: 'epub' as const,
      sectionId: 'chapter-1.xhtml',
      quote: { exact: 'records every amber mark' },
    },
  };
  useGlossaPanelStore.setState({
    isOpen: true,
    isPinned: false,
    isCollapsed: false,
    width: '32%',
    selection,
    contextPack: createContextPack({ selection, selectionContext: [selection] }),
    navigator: null,
  });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  root.unmount();
  host.remove();
  if (originalFlag === undefined) delete env[flagName];
  else env[flagName] = originalFlag;
});

describe('Glossa panel in the macOS Tauri WebView', () => {
  test('renders the selection preview and closes without a model request', async () => {
    expect((window.top ?? window) as unknown as Record<string, unknown>).toHaveProperty(
      '__TAURI_INTERNALS__',
    );
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    root.render(
      React.createElement(GlossaPanel, {
        safeAreaInsets: null,
        systemUIVisible: false,
        statusBarHeight: 0,
      }),
    );
    await nextFrame();

    expect(host.querySelector('[aria-label="Glossa"]')?.textContent).toContain(
      'records every amber mark',
    );
    expect(host.textContent).toContain('仅选区 · 未使用后文');
    expect(fetchSpy).not.toHaveBeenCalled();

    (host.querySelector('[aria-label="Close Glossa"]') as HTMLButtonElement).click();
    await nextFrame();
    expect(host.querySelector('[aria-label="Glossa"]')).toBeNull();
    expect(useGlossaPanelStore.getState().selection?.text).toBe('records every amber mark');
    fetchSpy.mockRestore();
  });
});
