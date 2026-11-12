/** Static allowlist: no paths, URLs or executable code from settings. */
export const pluginLoaders = {
  zotero: () => import('./zotero/ZoteroPanel'),
  conversation: () => import('@/glossa/ui/ConversationPanel'),
  mindmap: () => import('@/glossa/ui/MindmapPanel'),
  pdfAutoContents: () => import('./pdfAutoContents'),
  metadataRecognition: () => import('./metadataRecognition'),
  readingTime: () => import('./readingTime'),
  webImport: () => import('./webImport'),
};
export const pluginPanelLoaders = {
  conversation: pluginLoaders.conversation,
  mindmap: pluginLoaders.mindmap,
  pdfAutoContents: () => import('./PDFContentsPanel'),
};
