import type { SystemSettings } from '@/types/settings';
import type { NotebookTab } from '@/store/notebookStore';
import { PANEL_PLUGINS, isPluginEnabled, pluginSupportsFormat } from '../plugins/registry';

// Compatibility facade for existing reader integrations and persisted preferences.
export {
  pluginSupportsFormat,
  PLUGINS as OFFICIAL_MODULES,
  PANEL_PLUGINS as PANEL_MODULES,
  isPluginEnabled as isOfficialModuleEnabled,
  type PluginId as OfficialModuleId,
  type PluginPreferences as OfficialModulePreferences,
} from '../plugins/registry';

export const resolveNotebookTab = (
  settings: Pick<SystemSettings, 'officialModules'>,
  tab: NotebookTab,
  format = 'EPUB',
): NotebookTab => {
  const available = PANEL_PLUGINS.filter(
    (plugin) => pluginSupportsFormat(plugin, format) && isPluginEnabled(settings, plugin.id),
  );
  if (tab === 'notes' || available.some((plugin) => plugin.id === tab)) return tab;
  return available[0]?.id ?? 'notes';
};
