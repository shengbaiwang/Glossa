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
});
