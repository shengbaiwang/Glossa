import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
});

afterEach(() => {
  localStorage.removeItem('customShortcuts');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const getModule = async () => {
  return await import('../../helpers/shortcuts');
};

const getDefaults = async () => {
  const mod = await getModule();
  return mod.loadShortcuts();
};

describe('Shortcut entry structure', () => {
  it('each shortcut entry has keys, description, and section', async () => {
    const shortcuts = await getDefaults();
    for (const [name, entry] of Object.entries(shortcuts)) {
      expect(entry, `${name} should have keys array`).toHaveProperty('keys');
      expect(Array.isArray(entry.keys), `${name}.keys should be an array`).toBe(true);
      expect(entry, `${name} should have description`).toHaveProperty('description');
      expect(typeof entry.description, `${name}.description should be a string`).toBe('string');
      expect(entry, `${name} should have section`).toHaveProperty('section');
    }
  });
});

describe('custom shortcut persistence', () => {
  it('keeps defaults when preference storage is unavailable', async () => {
    const mod = await getModule();
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(mod.loadShortcuts()).toEqual(mod.DEFAULT_SHORTCUTS);
  });
  it.each([
    '{broken',
    'null',
    '[]',
    '42',
  ])('ignores malformed stored configuration %s', async (stored) => {
    const mod = await getModule();
    localStorage.setItem('customShortcuts', stored);
    expect(mod.loadShortcuts()).toEqual(mod.DEFAULT_SHORTCUTS);
  });

  it('validates stored arrays while preserving disabled actions', async () => {
    const mod = await getModule();
    localStorage.setItem(
      'customShortcuts',
      JSON.stringify({
        onGoRight: [],
        onGoLeft: ['ctrl+x', 12],
        onZoomIn: ['ctrl++'],
        unknownAction: ['q'],
      }),
    );
    const shortcuts = mod.loadShortcuts();
    expect(shortcuts.onGoRight.keys).toEqual([]);
    expect(shortcuts.onGoLeft.keys).toEqual(mod.DEFAULT_SHORTCUTS.onGoLeft.keys);
    expect(shortcuts.onZoomIn.keys).toEqual(['ctrl++']);
    expect(shortcuts).not.toHaveProperty('unknownAction');
  });

  it('notifies mounted listeners only after successful persistence', async () => {
    const mod = await getModule();
    const changed = vi.fn(() => expect(mod.loadShortcuts().onGoRight.keys).toEqual(['x']));
    window.addEventListener('shortcutUpdate', changed);
    try {
      const shortcuts = mod.loadShortcuts();
      mod.saveShortcuts({ ...shortcuts, onGoRight: { ...shortcuts.onGoRight, keys: ['x'] } });
      expect(changed).toHaveBeenCalledTimes(1);
      vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
        throw new Error('quota');
      });
      expect(() => mod.saveShortcuts(shortcuts)).toThrow('quota');
      expect(changed).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('shortcutUpdate', changed);
    }
  });
});

describe('No identical keybinding lists across actions (#3675)', () => {
  // Pre-existing pairs where two actions intentionally share the exact
  // same key list — both handlers guard on runtime context.
  // TODO: consider giving these distinct bindings to avoid the same
  // class of bug as #3675.
  const KNOWN_PAIRS: ReadonlySet<string> = new Set([
    'onSearchSelection,onShowSearchBar', // ctrl+f / cmd+f
  ]);

  it('should not have two actions with exactly the same key list', async () => {
    const shortcuts = await getDefaults();
    const keyListToActions = new Map<string, string[]>();
    for (const [name, entry] of Object.entries(shortcuts)) {
      const id = [...entry.keys].sort().join(',').toLowerCase();
      const actions = keyListToActions.get(id) ?? [];
      actions.push(name);
      keyListToActions.set(id, actions);
    }
    const duplicates: string[] = [];
    for (const [keys, actions] of keyListToActions) {
      if (actions.length > 1) {
        const pairId = [...actions].sort().join(',');
        if (!KNOWN_PAIRS.has(pairId)) {
          duplicates.push(`[${keys}] is shared by: ${actions.join(', ')}`);
        }
      }
    }
    expect(
      duplicates,
      `Actions with identical keybinding lists:\n${duplicates.join('\n')}`,
    ).toEqual([]);
  });
});

describe('getShortcutsForDisplay', () => {
  it('shows every custom binding even when its modifier uses another platform spelling', async () => {
    const mod = await getModule();
    const shortcuts = mod.loadShortcuts();
    shortcuts.onToggleSideBar.keys = ['s', 'opt+y'];
    const general = mod
      .getShortcutsForDisplay(false, shortcuts)
      .find((section) => section.section === 'General');
    expect(general?.items.find((item) => item.description === 'Toggle Sidebar')?.keys).toEqual([
      's',
      'opt+y',
    ]);
  });

  it('shows custom Control and Command bindings together on Mac', async () => {
    const mod = await getModule();
    const shortcuts = mod.loadShortcuts();
    shortcuts.onShowSearchBar.keys = ['ctrl+x', 'cmd+y'];
    const general = mod
      .getShortcutsForDisplay(true, shortcuts)
      .find((section) => section.section === 'General');
    expect(general?.items.find((item) => item.description === 'Search in Book')?.keys).toEqual([
      'ctrl+x',
      'cmd+y',
    ]);
  });

  it('returns sections in the correct order', async () => {
    const mod = await getModule();
    const result = mod.getShortcutsForDisplay(true);
    const sectionNames = result.map((s) => s.section);
    expect(sectionNames).toEqual(['General', 'Navigation', 'Selection', 'Zoom', 'Window']);
  });

  it('excludes entries with empty section', async () => {
    const mod = await getModule();
    const result = mod.getShortcutsForDisplay(true);
    const allDescriptions = result.flatMap((s) => s.items.map((i) => i.description));
    // onEscape and onSaveNote have empty section, should be excluded
    const shortcuts = mod.loadShortcuts();
    const hiddenEntries = Object.values(shortcuts).filter((e) => e.section === '');
    for (const hidden of hiddenEntries) {
      expect(allDescriptions).not.toContain(hidden.description);
    }
  });

  it('each item has a description and non-empty keys', async () => {
    const mod = await getModule();
    const result = mod.getShortcutsForDisplay(false);
    for (const section of result) {
      for (const item of section.items) {
        expect(item.description.length).toBeGreaterThan(0);
        expect(item.keys.length).toBeGreaterThan(0);
      }
    }
  });

  it('on Mac, returns cmd-prefixed keys for onShowSearchBar', async () => {
    const mod = await getModule();
    const result = mod.getShortcutsForDisplay(true);
    const general = result.find((s) => s.section === 'General');
    const searchItem = general?.items.find((i) =>
      i.keys.some((k) => k.includes('cmd') || k.includes('f')),
    );
    expect(searchItem).toBeDefined();
    expect(searchItem!.keys.some((k) => k.includes('cmd'))).toBe(true);
    expect(searchItem!.keys.some((k) => k.includes('ctrl'))).toBe(false);
  });

  it('on non-Mac, returns ctrl-prefixed keys for onShowSearchBar', async () => {
    const mod = await getModule();
    const result = mod.getShortcutsForDisplay(false);
    const general = result.find((s) => s.section === 'General');
    const searchItem = general?.items.find((i) =>
      i.keys.some((k) => k.includes('ctrl') || k.includes('f')),
    );
    expect(searchItem).toBeDefined();
    expect(searchItem!.keys.some((k) => k.includes('ctrl'))).toBe(true);
    expect(searchItem!.keys.some((k) => k.includes('cmd'))).toBe(false);
  });
});
