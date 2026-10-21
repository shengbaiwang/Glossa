import type { SystemSettings } from '@/types/settings';
import type { NotebookTab } from '@/store/notebookStore';
import { PANEL_PLUGINS, isPluginEnabled } from '../plugins/registry';

// Compatibility facade for existing reader integrations and persisted preferences.
export {
  PLUGINS as OFFICIAL_MODULES,
  PANEL_PLUGINS as PANEL_MODULES,
  isPluginEnabled as isOfficialModuleEnabled,
  type PluginId as OfficialModuleId,
  type PluginPreferences as OfficialModulePreferences,
} from '../plugins/registry';

export const resolveNotebookTab = (
  settings: Pick<SystemSettings, 'officialModules'>,
  tab: NotebookTab,
): NotebookTab => {
  if (tab === 'notes' || isPluginEnabled(settings, tab)) return tab;
  return PANEL_PLUGINS.find((plugin) => isPluginEnabled(settings, plugin.id))?.id ?? 'notes';
};
