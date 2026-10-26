import { describe, expect, it } from 'vitest';
import {
  OFFICIAL_MODULES,
  isOfficialModuleEnabled,
  resolveNotebookTab,
} from '@/glossa/modules/registry';

describe('bundled official modules', () => {
  it('preserves the default experience for settings without module preferences', () => {
    expect(OFFICIAL_MODULES.map((module) => module.id)).toEqual([
      'conversation',
      'mindmap',
      'pdfAutoContents',
      'webImport',
    ]);
    for (const module of OFFICIAL_MODULES)
      expect(isOfficialModuleEnabled({}, module.id)).toBe(true);
    expect(resolveNotebookTab({}, 'conversation')).toBe('conversation');
  });
  it('falls back only when the selected module is disabled and always keeps notes', () => {
    const one = { officialModules: { conversation: false } };
    expect(resolveNotebookTab(one, 'conversation')).toBe('mindmap');
    expect(resolveNotebookTab(one, 'notes')).toBe('notes');
    const none = { officialModules: { conversation: false, mindmap: false } };
    expect(resolveNotebookTab(none, 'mindmap')).toBe('notes');
    expect(resolveNotebookTab(none, 'notes')).toBe('notes');
    expect(isOfficialModuleEnabled(none, 'mindmap')).toBe(false);
  });
  it('offers Markdown conversation without extending mind maps or PDF tools', () => {
    expect(resolveNotebookTab({}, 'conversation', 'MD')).toBe('conversation');
    expect(resolveNotebookTab({}, 'mindmap', 'MD')).toBe('conversation');
    expect(
      resolveNotebookTab({ officialModules: { conversation: false } }, 'conversation', 'MD'),
    ).toBe('notes');
    expect(resolveNotebookTab({}, 'notes', 'MD')).toBe('notes');
  });
  it('resolves plugin panels for the current format without selecting an incompatible panel', () => {
    expect(resolveNotebookTab({}, 'conversation', 'PDF')).toBe('pdfAutoContents');
    expect(resolveNotebookTab({}, 'pdfAutoContents', 'EPUB')).toBe('conversation');
    expect(
      resolveNotebookTab({ officialModules: { pdfAutoContents: false } }, 'pdfAutoContents', 'PDF'),
    ).toBe('notes');
  });
});
