import clsx from 'clsx';
import React, { useEffect, useRef, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useSettingsStore, type SettingsDialogScope } from '@/store/settingsStore';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { useTranslation } from '@/hooks/useTranslation';
import { useCommandPalette } from '@/components/command-palette';
import {
  Type,
  PanelsTopLeft,
  Palette,
  Hand,
  Languages,
  Cloud,
  Ellipsis,
  RotateCcw,
  Settings2,
  Database,
  Braces,
  X,
  Search,
  Puzzle,
} from '@/components/GlossaIcons';
import { getDirFromUILanguage } from '@/utils/rtl';
import { getCommandPaletteShortcut } from '@/services/environment';
import FontPanel from './FontPanel';
import LayoutPanel from './LayoutPanel';
import ThemePanel from './ThemePanel';
import IntegrationsPanel from './IntegrationsPanel';
import Dropdown from '@/components/Dropdown';
import Dialog from '@/components/Dialog';
import DialogMenu from './DialogMenu';
import ControlPanel from './ControlPanel';
import LangPanel from './LangPanel';
import MiscPanel from './MiscPanel';
import ApplicationPanel from './ApplicationPanel';
import PluginsPanel, { type PluginSettingsTarget } from './PluginsPanel';
import SettingsScopeControl from './SettingsScopeControl';
import ReadingDisplayControls from './ReadingDisplayControls';

// Preserve existing reader shortcuts and remembered categories after consolidation.
const pluginTarget = (panel: string | null): PluginSettingsTarget | null => {
  if (panel?.toLowerCase() === 'models') return 'models';
  if (panel?.toLowerCase() === 'conversation') return 'conversation';
  return null;
};

export type SettingsPanelType =
  | 'General'
  | 'Data'
  | 'Plugins'
  | 'Font'
  | 'Layout'
  | 'Theme'
  | 'Control'
  | 'Language'
  | 'Integrations'
  | 'Models'
  | 'Conversation'
  | 'Custom';
export type SettingsPanelPanelProp = {
  bookKey: string;
  onRegisterReset: (resetFn: () => void) => void;
};

type TabConfig = {
  tab: SettingsPanelType;
  icon: React.ElementType;
  label: string;
  disabled?: boolean;
};

const SettingsDialog: React.FC<{
  bookKey: string;
  scope?: SettingsDialogScope;
  onSyncLibrary?: () => void;
}> = ({ bookKey, scope: explicitScope, onSyncLibrary }) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const closeIconSize = useResponsiveSize(16);
  const [isRtl] = useState(() => getDirFromUILanguage() === 'rtl');
  const tabsRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const displayReset = useRef<(() => void) | null>(null);
  const {
    setFontPanelView,
    setSettingsDialogOpen,
    activeSettingsItemId,
    setActiveSettingsItemId,
    requestedPanel,
    setRequestedPanel,
    settingsDialogScope,
  } = useSettingsStore();
  const { open: openCommandPalette } = useCommandPalette();

  const handleOpenCommandPalette = () => {
    openCommandPalette();
    setSettingsDialogOpen(false);
  };

  const scope = explicitScope ?? settingsDialogScope ?? 'application';
  const reading = scope === 'reading';
  const panelBookKey = reading ? bookKey : '';
  const [pluginSettingsTarget, setPluginSettingsTarget] = useState<PluginSettingsTarget | null>(
    () =>
      pluginTarget(
        requestedPanel ??
          localStorage.getItem('lastApplicationSettingsPanel') ??
          localStorage.getItem('lastConfigPanel'),
      ),
  );
  const tabConfig: TabConfig[] = [
    { tab: 'General', icon: Settings2, label: _('General') },
    { tab: 'Data', icon: Database, label: _('Library Data') },
    { tab: 'Plugins', icon: Puzzle, label: _('Plugins') },
    {
      tab: 'Font',
      icon: Type,
      label: _('Font'),
    },
    {
      tab: 'Layout',
      icon: PanelsTopLeft,
      label: _('Layout'),
    },
    {
      tab: 'Theme',
      icon: Palette,
      label: _('Theme'),
    },
    {
      tab: 'Control',
      icon: Hand,
      label: _('Reading Controls'),
    },
    {
      tab: 'Language',
      icon: Languages,
      label: _('Language'),
    },
    {
      tab: 'Integrations',
      icon: Cloud,
      label: _('Cloud Sync'),
    },
    {
      tab: 'Custom',
      icon: Braces,
      label: _('Custom Styles'),
    },
  ].filter((tab) => {
    if (reading) return ['Font', 'Layout', 'Theme'].includes(tab.tab);
    return true;
  }) as TabConfig[];

  const panelGroups = reading
    ? [{ label: '', tabs: ['Font', 'Layout', 'Theme'] }]
    : [
        {
          label: _('Application'),
          tabs: ['General', 'Theme', 'Language', 'Integrations', 'Plugins', 'Data'],
        },
        { label: _('Reading Defaults'), tabs: ['Font', 'Layout', 'Control', 'Custom'] },
      ];

  const [activePanel, setActivePanel] = useState<SettingsPanelType>(() => {
    // Deep-link: if a caller asked for a specific panel before opening the
    // dialog, honor that for the initial state. The store-clear lives in
    // a useEffect below so we never call a zustand setter during render
    // (would warn "Cannot update a component while rendering another").
    const requested = tabConfig.find(
      (tab) =>
        tab.tab.toLowerCase() ===
        (pluginTarget(requestedPanel) ? 'plugins' : requestedPanel?.toLowerCase()),
    );
    if (requested) return requested.tab;
    const lastPanel =
      localStorage.getItem(
        reading ? 'lastReadingAppearancePanel' : 'lastApplicationSettingsPanel',
      ) ?? localStorage.getItem('lastConfigPanel');
    if (!reading && pluginTarget(lastPanel)) return 'Plugins';
    if (lastPanel && tabConfig.some((tab) => tab.tab === lastPanel)) {
      return lastPanel as SettingsPanelType;
    }
    return reading ? 'Font' : 'General';
  });

  useEffect(() => {
    if (!tabConfig.some((tab) => tab.tab === activePanel)) {
      setActivePanel(reading ? 'Font' : 'General');
    }
    // Available panels depend on the settings scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePanel, reading]);

  // Clear the deep-link request after the initial render has consumed it,
  // so the next dialog open doesn't stick on the same panel. Effect runs
  // once on mount; subsequent callers must call setRequestedPanel before
  // opening the dialog again.
  useEffect(() => {
    if (!requestedPanel) return;
    const requested = tabConfig.find(
      (tab) =>
        tab.tab.toLowerCase() ===
        (pluginTarget(requestedPanel) ? 'plugins' : requestedPanel.toLowerCase()),
    );
    if (requested) {
      setPluginSettingsTarget(pluginTarget(requestedPanel));
      setActivePanel(requested.tab);
    }
    setRequestedPanel(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedPanel, reading, setRequestedPanel]);

  const handleSetActivePanel = (tab: SettingsPanelType) => {
    setPluginSettingsTarget(null);
    setActivePanel(tab);
    setFontPanelView('main-fonts');
    localStorage.setItem(
      reading ? 'lastReadingAppearancePanel' : 'lastApplicationSettingsPanel',
      tab,
    );
  };

  // sync localStorage and fontPanelView when activePanel changes
  const activePanelRef = useRef(activePanel);
  useEffect(() => {
    if (activePanelRef.current !== activePanel) {
      activePanelRef.current = activePanel;
      setFontPanelView('main-fonts');
      localStorage.setItem(
        reading ? 'lastReadingAppearancePanel' : 'lastApplicationSettingsPanel',
        activePanel,
      );
    }
  }, [activePanel, reading, setFontPanelView]);

  const [resetFunctions, setResetFunctions] = useState<
    Record<SettingsPanelType, (() => void) | null>
  >({
    General: null,
    Plugins: null,
    Data: null,
    Font: null,
    Layout: null,
    Theme: null,
    Control: null,
    Language: null,
    Integrations: null,
    Models: null,
    Conversation: null,
    Custom: null,
  });

  const registerResetFunction = (panel: SettingsPanelType, resetFn: () => void) => {
    setResetFunctions((prev) => ({ ...prev, [panel]: resetFn }));
  };

  const handleResetCurrentPanel = () => {
    if (activePanel === 'Layout' && reading) displayReset.current?.();
    const resetFn = resetFunctions[activePanel];
    if (resetFn) {
      resetFn();
    }
  };

  const handleClose = () => {
    setSettingsDialogOpen(false);
  };

  // handle activeSettingsItemId: switch to correct panel and scroll to item
  useEffect(() => {
    if (!activeSettingsItemId) return;

    // parse panel from item id (format: settings.panel.itemName)
    // Existing saved search targets keep reaching the relocated plugin switch.
    const settingId = activeSettingsItemId.replace('settings.general.module.', 'settings.plugins.');
    const parts = settingId.split('.');
    if (parts.length >= 2) {
      const panelMap: Record<string, SettingsPanelType> = {
        font: 'Font',
        layout: 'Layout',
        theme: 'Theme',
        color: 'Theme',
        general: 'General',
        plugins: 'Plugins',
        data: 'Data',
        models: 'Plugins',
        control: 'Control',
        language: 'Language',
        integrations: 'Integrations',
        conversation: 'Plugins',
        custom: 'Custom',
      };
      const panelKey = parts[1]?.toLowerCase();
      if (!reading) {
        setPluginSettingsTarget(
          settingId === 'settings.plugins.pdfContentsOnImport'
            ? 'pdfAutoContents'
            : panelKey === 'models' || settingId === 'settings.plugins.models'
              ? 'models'
              : panelKey === 'conversation' || settingId === 'settings.plugins.prompts'
                ? 'conversation'
                : null,
        );
      }
      const targetPanel = [
        'settings.control.checkUpdates',
        'settings.control.nightlyChannel',
      ].includes(activeSettingsItemId)
        ? 'General'
        : panelMap[panelKey || ''];
      if (
        targetPanel &&
        tabConfig.some((tab) => tab.tab === targetPanel) &&
        targetPanel !== activePanel
      ) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- panel switch based on external navigation is intended
        setActivePanel(targetPanel);
      }
    }

    // scroll to item after panel renders
    const timeoutId = setTimeout(() => {
      const element = panelRef.current?.querySelector(`[data-setting-id="${settingId}"]`);
      if (element) {
        let ancestor = element.parentElement;
        while (ancestor && ancestor !== panelRef.current) {
          if (ancestor instanceof HTMLDetailsElement) ancestor.open = true;
          ancestor = ancestor.parentElement;
        }
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        element.classList.add('settings-highlight');
        setTimeout(() => element.classList.remove('settings-highlight'), 2000);
      }
      setActiveSettingsItemId(null);
    }, 100);

    return () => clearTimeout(timeoutId);
  }, [activeSettingsItemId, activePanel, setActiveSettingsItemId]);

  const currentPanel = tabConfig.find((tab) => tab.tab === activePanel);

  const windowControls = (
    <div className='flex h-full items-center justify-end gap-x-[var(--glossa-gap-chrome)]'>
      <button
        onClick={handleOpenCommandPalette}
        aria-label={_('Search Settings')}
        title={`${_('Search Settings')} (${getCommandPaletteShortcut()})`}
        className='touch-target glossa-icon-button'
      >
        <Search size={18} />
      </button>
      {['Font', 'Layout', 'Theme', 'Control', 'Language', 'Custom'].includes(activePanel) && (
        <button
          type='button'
          onClick={handleResetCurrentPanel}
          aria-label={_('Restore Defaults')}
          title={_('Reset {{settings}}', { settings: currentPanel?.label ?? '' })}
          className='touch-target glossa-icon-button'
        >
          <RotateCcw size={18} />
        </button>
      )}
      {activePanel === 'Font' && (
        <Dropdown
          label={_('Manage Custom Fonts')}
          className='dropdown-bottom dropdown-end'
          buttonClassName='touch-target glossa-icon-button'
          toggleButton={<Ellipsis size={18} />}
        >
          <DialogMenu
            bookKey={panelBookKey}
            activePanel={activePanel}
            onReset={handleResetCurrentPanel}
          />
        </Dropdown>
      )}
      <button
        onClick={handleClose}
        aria-label={_('Close')}
        className='touch-target glossa-icon-button'
      >
        <X size={closeIconSize} />
      </button>
    </div>
  );

  return (
    <Dialog
      isOpen={true}
      onClose={handleClose}
      // Settings sits in the overlay z-index scale (see ModalPortal.tsx) above
      // the RSVP immersive overlay (z-100) so dictionary management opened from
      // inside RSVP shows on top instead of behind it (#3235), and below the
      // modal layer (z-120) so a modal opened from inside Settings (e.g. Add
      // OPDS Catalog) renders on top. !important beats the Dialog's hardcoded z-50.
      className={clsx(
        'glossa-settings modal-open !z-[110]',
        reading ? 'glossa-reader-settings' : 'glossa-application-settings',
      )}
      contentClassName='!px-4 sm:!px-5'
      bgClassName={reading ? 'sm:!bg-black/20' : 'sm:!bg-black/50'}
      boxClassName={clsx(
        'overflow-hidden not-eink:bg-base-200',
        appService?.isMobile && 'sm:max-w-[90%] sm:w-3/4',
      )}
      snapHeight={appService?.isMobile ? 0.7 : undefined}
      // Settings panels can be tall (Layout / Color especially); native
      // scrollbars vanish on Android/iOS webviews, so use OverlayScrollbars
      // to keep a visible, theme-aware track on every platform.
      useOverlayScroll
      header={
        <div className='glossa-settings-heading'>
          <div className='glossa-dialog-title'>
            {reading ? _('Reading Appearance') : _('Settings')}
          </div>
          {windowControls}
        </div>
      }
    >
      {!reading && (
        <select
          aria-label={_('Settings Panels')}
          className='select eink-bordered glossa-settings-mobile-panel-select w-full'
          value={activePanel}
          onChange={(event) => handleSetActivePanel(event.target.value as SettingsPanelType)}
        >
          {panelGroups.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.tabs.map((tab) => {
                const config = tabConfig.find((item) => item.tab === tab);
                return (
                  config && (
                    <option key={tab} value={tab}>
                      {config.label}
                    </option>
                  )
                );
              })}
            </optgroup>
          ))}
        </select>
      )}
      <div
        className={clsx('glossa-settings-workspace', !reading && 'glossa-application-workspace')}
      >
        <nav
          ref={tabsRef}
          aria-label={_('Settings Panels')}
          className={clsx('glossa-settings-navigation', reading && 'dialog-tabs')}
        >
          {panelGroups.map((group) => (
            <div key={group.label} className='glossa-settings-nav-group'>
              {group.label && <div className='glossa-settings-group-label'>{group.label}</div>}
              {group.tabs.map((tab) => {
                const config = tabConfig.find((item) => item.tab === tab);
                if (!config) return null;
                const Icon = config.icon;
                return (
                  <button
                    key={tab}
                    type='button'
                    data-tab={tab}
                    aria-label={config.label}
                    aria-pressed={activePanel === tab}
                    className='glossa-settings-nav-button'
                    onClick={() => handleSetActivePanel(config.tab)}
                    onKeyDownCapture={(event) => {
                      if (
                        ![
                          'ArrowRight',
                          'ArrowLeft',
                          'ArrowDown',
                          'ArrowUp',
                          'Home',
                          'End',
                        ].includes(event.key)
                      )
                        return;
                      event.preventDefault();
                      event.stopPropagation();
                      const buttons = Array.from(
                        tabsRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [],
                      );
                      const index = buttons.indexOf(event.currentTarget);
                      const direction =
                        event.key === 'ArrowDown' ||
                        event.key === (isRtl ? 'ArrowLeft' : 'ArrowRight')
                          ? 1
                          : -1;
                      const target =
                        event.key === 'Home'
                          ? buttons[0]
                          : event.key === 'End'
                            ? buttons.at(-1)
                            : buttons[(index + direction + buttons.length) % buttons.length];
                      target?.focus();
                      target?.click();
                    }}
                  >
                    <Icon aria-hidden='true' size={18} />
                    <span>{config.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
        <div
          ref={panelRef}
          role='group'
          aria-label={`${_(currentPanel?.label || '')} - ${_('Settings')}`}
          className='glossa-settings-content'
        >
          {reading && <SettingsScopeControl bookKey={bookKey} />}
          {!reading && <div className='glossa-settings-panel-title'>{currentPanel?.label}</div>}
          {(activePanel === 'General' || activePanel === 'Data') && (
            <ApplicationPanel section={activePanel} />
          )}
          {activePanel === 'Plugins' && (
            <PluginsPanel
              key={pluginSettingsTarget ?? 'grid'}
              initialSettings={pluginSettingsTarget}
            />
          )}
          {activePanel === 'Font' && (
            <FontPanel
              key={panelBookKey}
              bookKey={panelBookKey}
              showFooter={false}
              onRegisterReset={(fn) => registerResetFunction('Font', fn)}
            />
          )}
          {activePanel === 'Layout' && (
            <>
              {reading && (
                <ReadingDisplayControls
                  bookKey={bookKey}
                  onRegisterReset={(fn) => {
                    displayReset.current = fn;
                  }}
                />
              )}
              <LayoutPanel
                key={panelBookKey}
                bookKey={panelBookKey}
                onRegisterReset={(fn) => registerResetFunction('Layout', fn)}
              />
            </>
          )}
          {activePanel === 'Theme' && (
            <ThemePanel
              key={panelBookKey}
              readingOnly={reading}
              bookKey={panelBookKey}
              onRegisterReset={(fn) => registerResetFunction('Theme', fn)}
            />
          )}
          {activePanel === 'Control' && (
            <ControlPanel
              key={panelBookKey}
              bookKey={panelBookKey}
              onRegisterReset={(fn) => registerResetFunction('Control', fn)}
            />
          )}

          {activePanel === 'Language' && (
            <LangPanel
              key={panelBookKey}
              bookKey={panelBookKey}
              onRegisterReset={(fn) => registerResetFunction('Language', fn)}
            />
          )}

          {activePanel === 'Integrations' && <IntegrationsPanel onSyncLibrary={onSyncLibrary} />}
          {activePanel === 'Custom' && (
            <MiscPanel
              key={panelBookKey}
              bookKey={panelBookKey}
              onRegisterReset={(fn) => registerResetFunction('Custom', fn)}
            />
          )}
        </div>
      </div>
    </Dialog>
  );
};

export default SettingsDialog;
