/** Static allowlist: no paths, URLs or executable code from settings. */
export const pluginLoaders = {
  conversation: () => import('@/glossa/ui/ConversationPanel'),
  mindmap: () => import('@/glossa/ui/MindmapPanel'),
  pdfAutoContents: () => import('./pdfAutoContents'),
};
