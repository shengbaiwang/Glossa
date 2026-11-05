'use client';

import React, { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { useShortcutConfig } from '@/hooks/useShortcuts';
import { matchesShortcut } from '@/utils/shortcutKeys';
import { useSettingsStore } from '@/store/settingsStore';
import { useThemeStore } from '@/store/themeStore';
import { useEnv } from '@/context/EnvContext';
import { isTauriAppPlatform } from '@/services/environment';
import { tauriHandleSetAlwaysOnTop, tauriHandleToggleFullScreen } from '@/utils/window';
import { nextThemeMode } from '@/utils/ambientLight';
import { setAboutDialogVisible } from '@/components/AboutWindow';
import { saveSysSettings } from '@/helpers/settings';
import { SettingsPanelType } from '@/components/settings/SettingsDialog';
import {
  CommandItem,
  buildCommandRegistry,
  searchCommands,
  CommandSearchResult,
  groupResultsByCategory,
  trackCommandUsage,
  getRecentCommands,
  CommandCategory,
} from '@/services/commandRegistry';

interface CommandPaletteContextValue {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  query: string;
  setQuery: (query: string) => void;
  results: CommandSearchResult[];
  groupedResults: Record<CommandCategory, CommandSearchResult[]>;
  recentItems: CommandItem[];
  executeCommand: (item: CommandItem) => void;
  commandItems: CommandItem[];
}

const CommandPaletteContext = createContext<CommandPaletteContextValue | null>(null);

export const useCommandPalette = (): CommandPaletteContextValue => {
  const context = useContext(CommandPaletteContext);
  if (!context) {
    throw new Error('useCommandPalette must be used within CommandPaletteProvider');
  }
  return context;
};

interface CommandPaletteProviderProps {
  children: React.ReactNode;
}

export const CommandPaletteProvider: React.FC<CommandPaletteProviderProps> = ({ children }) => {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
  const { themeMode, setThemeMode } = useThemeStore();
  const { settings, setSettingsDialogOpen, setActiveSettingsItemId } = useSettingsStore();

  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const shortcuts = useShortcutConfig();

  const isDesktop = isTauriAppPlatform() && !appService?.isMobile;

  // action handlers
  const toggleTheme = useCallback(() => {
    setThemeMode(nextThemeMode(themeMode, !!appService?.hasAmbientLightSensor));
  }, [themeMode, setThemeMode, appService?.hasAmbientLightSensor]);

  const toggleFullscreen = useCallback(() => {
    tauriHandleToggleFullScreen();
  }, []);

  const toggleAlwaysOnTop = useCallback(() => {
    const newValue = !settings.alwaysOnTop;
    saveSysSettings(envConfig, 'alwaysOnTop', newValue);
    tauriHandleSetAlwaysOnTop(newValue);
  }, [envConfig, settings.alwaysOnTop]);

  const toggleScreenWakeLock = useCallback(() => {
    const newValue = !settings.screenWakeLock;
    saveSysSettings(envConfig, 'screenWakeLock', newValue);
  }, [envConfig, settings.screenWakeLock]);

  const reloadPage = useCallback(() => {
    window.location.reload();
  }, []);

  const toggleOpenLastBooks = useCallback(() => {
    const newValue = !settings.openLastBooks;
    saveSysSettings(envConfig, 'openLastBooks', newValue);
  }, [envConfig, settings.openLastBooks]);

  const showAbout = useCallback(() => {
    setAboutDialogVisible(true);
  }, []);

  const openSettingsPanel = useCallback(
    (panel: SettingsPanelType, itemId?: string) => {
      useSettingsStore.getState().openSettingsDialog('application', '', panel);
      // panel is encoded in itemId (e.g., 'settings.font.defaultFontSize')
      // SettingsDialog will parse this to determine which panel to show
      if (itemId) {
        setActiveSettingsItemId(itemId);
      }
      setSettingsDialogOpen(true);
    },
    [setSettingsDialogOpen, setActiveSettingsItemId],
  );

  // build command registry
  const commandItems = useMemo(
    () =>
      buildCommandRegistry({
        _,
        openSettingsPanel,
        toggleTheme,
        toggleFullscreen,
        toggleAlwaysOnTop,
        toggleScreenWakeLock,
        reloadPage,
        toggleOpenLastBooks,
        showAbout,
        isDesktop,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      _,
      openSettingsPanel,
      toggleTheme,
      toggleFullscreen,
      toggleAlwaysOnTop,
      toggleScreenWakeLock,
      reloadPage,
      toggleOpenLastBooks,
      showAbout,
      isDesktop,
    ],
  );

  // search results
  const results = useMemo(() => searchCommands(query, commandItems), [query, commandItems]);
  const groupedResults = useMemo(() => groupResultsByCategory(results), [results]);

  // recent items
  const recentItems = useMemo(() => getRecentCommands(commandItems, 5), [commandItems]);

  // palette controls
  const open = useCallback(() => {
    setIsOpen(true);
    setQuery('');
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    setQuery('');
  }, []);

  const toggle = useCallback(() => {
    if (isOpen) {
      close();
    } else {
      open();
    }
  }, [isOpen, open, close]);

  // execute command
  const executeCommand = useCallback(
    (item: CommandItem) => {
      trackCommandUsage(item.id);
      close();
      // slight delay to allow modal to close before action
      requestAnimationFrame(() => {
        item.action();
      });
    },
    [close],
  );

  // Capture before open dialogs, while leaving a shortcut recorder in control.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.defaultPrevented ||
        e.isComposing ||
        document.activeElement?.closest('[data-shortcut-recorder]')
      )
        return;
      const focused = document.activeElement as HTMLElement | null;
      const isEditing = focused?.matches('input, textarea') || focused?.isContentEditable;
      if (isEditing && !e.ctrlKey && !e.metaKey) return;
      if (matchesShortcut(e, shortcuts.onOpenCommandPalette.keys)) {
        e.preventDefault();
        e.stopPropagation();
        setSettingsDialogOpen(false);
        toggle();
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [toggle, setSettingsDialogOpen, shortcuts]);

  const value = useMemo(
    () => ({
      isOpen,
      open,
      close,
      toggle,
      query,
      setQuery,
      results,
      groupedResults,
      recentItems,
      executeCommand,
      commandItems,
    }),
    [
      isOpen,
      open,
      close,
      toggle,
      query,
      setQuery,
      results,
      groupedResults,
      recentItems,
      executeCommand,
      commandItems,
    ],
  );

  return <CommandPaletteContext.Provider value={value}>{children}</CommandPaletteContext.Provider>;
};

export default CommandPaletteProvider;
