import type { SystemSettings } from '@/types/settings';
import { defineBundledPlugin } from './manifest';

/** Bundled, trusted plugins. Metadata never imports feature code or user data. */
export const PLUGINS = [
  defineBundledPlugin({
    id: 'conversation',
    author: 'Glossa',
    name: 'Conversation',
    version: '1.0.0',
    apiVersion: 1,
    activation: 'reader-panel',
    format: 'EPUB',
    capabilities: ['reading-harness', 'model-provider'],
  }),
  defineBundledPlugin({
    id: 'mindmap',
    author: 'Glossa',
    name: 'Mind map',
    version: '1.0.0',
    apiVersion: 1,
    activation: 'reader-panel',
    format: 'EPUB',
    capabilities: ['verified-sources', 'model-provider'],
  }),
  defineBundledPlugin({
    id: 'pdfAutoContents',
    author: 'Glossa',
    name: 'PDF automatic contents',
    version: '1.0.0',
    apiVersion: 1,
    activation: ['reader-panel', 'persistent-import'],
    format: 'PDF',
    capabilities: ['local-pdf-contents'],
  }),
] as const;
export type PluginId = (typeof PLUGINS)[number]['id'];
export type PluginPreferences = Partial<Record<PluginId, boolean>>;
// Retain the persisted key: existing preferences and backups need no migration.
export const isPluginEnabled = (
  settings: Pick<SystemSettings, 'officialModules'> | undefined,
  id: PluginId,
): boolean => settings?.officialModules?.[id] !== false;
export const PANEL_PLUGINS = PLUGINS.filter((plugin) =>
  typeof plugin.activation === 'string'
    ? plugin.activation === 'reader-panel'
    : plugin.activation.includes('reader-panel'),
);
