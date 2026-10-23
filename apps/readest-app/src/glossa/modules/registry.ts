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
  format = 'EPUB',
): NotebookTab => {
  const available = PANEL_PLUGINS.filter(
    (plugin) => plugin.format === format && isPluginEnabled(settings, plugin.id),
  );
  if (tab === 'notes' || available.some((plugin) => plugin.id === tab)) return tab;
  return available[0]?.id ?? 'notes';
};
