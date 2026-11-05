import { stubTranslation as _ } from '@/utils/misc';
import { filterPlatformKeys, isValidShortcut } from '@/utils/shortcutKeys';

export type ShortcutEntry = {
  keys: string[];
  description: string;
  section: string;
};

export const DEFAULT_SHORTCUTS = {
  onSwitchSideBar: {
    keys: ['ctrl+Tab', 'opt+Tab', 'alt+Tab'],
    description: _('Switch Sidebar Tab'),
    section: 'General',
  },
  onToggleSideBar: {
    keys: ['s'],
    description: _('Toggle Sidebar'),
    section: 'General',
  },
  onToggleNotebook: {
    keys: ['n'],
    description: _('Toggle Notebook'),
    section: 'General',
  },
  onShowSearchBar: {
    keys: ['ctrl+f', 'cmd+f'],
    description: _('Search in Book'),
    section: 'General',
  },
  onToggleScrollMode: {
    keys: ['shift+j'],
    description: _('Toggle Scroll Mode'),
    section: 'General',
  },
  onToggleBookmark: {
    keys: ['ctrl+b', 'cmd+b'],
    description: _('Toggle Bookmark'),
    section: 'General',
  },
  onToggleAutoScroll: {
    keys: ['shift+a'],
    description: _('Toggle Auto Scroll'),
    section: 'General',
  },
  onToggleToolbar: {
    keys: ['Enter'],
    description: _('Toggle Toolbar'),
    section: 'General',
  },
  onHighlightSelection: {
    keys: ['ctrl+h', 'cmd+h'],
    description: _('Highlight Selection'),
    section: 'Selection',
  },
  onUnderlineSelection: {
    keys: ['ctrl+u', 'cmd+u'],
    description: _('Underline Selection'),
    section: 'Selection',
  },
  onAnnotateSelection: {
    keys: ['ctrl+n', 'cmd+n'],
    description: _('Annotate Selection'),
    section: 'Selection',
  },
  onSearchSelection: {
    keys: ['ctrl+f', 'cmd+f'],
    description: _('Search Selection'),
    section: 'Selection',
  },
  onCopySelection: {
    keys: ['ctrl+c', 'cmd+c'],
    description: _('Copy Selection'),
    section: 'Selection',
  },
  onAdjustTextSelection: {
    // Standard desktop shortcuts for refining an active selection (#4728):
    // Shift+←/→ by character, Ctrl/Alt(Option)+Shift+←/→ by word. Only act while
    // text is selected; otherwise these keys fall through to page navigation.
    keys: [
      'shift+ArrowLeft',
      'shift+ArrowRight',
      'ctrl+shift+ArrowLeft',
      'ctrl+shift+ArrowRight',
      'opt+shift+ArrowLeft',
      'opt+shift+ArrowRight',
    ],
    description: _('Adjust Text Selection'),
    section: 'Selection',
  },
  onOpenFontLayoutSettings: {
    keys: ['shift+f', 'ctrl+,', 'cmd+,'],
    description: _('Open Settings'),
    section: 'General',
  },
  onOpenCommandPalette: {
    keys: ['ctrl+shift+p', 'cmd+shift+p'],
    description: _('Open Command Palette'),
    section: 'General',
  },
  onOpenShortcutsHelp: {
    keys: ['shift+?'],
    description: _('Show Keyboard Shortcuts'),
    section: 'General',
  },
  onOpenBooks: {
    keys: ['ctrl+o'],
    description: _('Open Books'),
    section: 'General',
  },
  onReloadPage: {
    keys: ['shift+r'],
    description: _('Reload Page'),
    section: 'General',
  },
  onToggleFullscreen: {
    keys: ['F11'],
    description: _('Toggle Fullscreen'),
    section: 'Window',
  },
  onCloseWindow: {
    keys: ['ctrl+w', 'cmd+w'],
    description: _('Close Window'),
    section: 'Window',
  },
  onQuitApp: {
    keys: ['ctrl+q', 'cmd+q'],
    description: _('Quit App'),
    section: 'Window',
  },
  onGoLeft: {
    keys: ['ArrowLeft', 'h', 'shift+ '],
    description: _('Go Left / Previous Page'),
    section: 'Navigation',
  },
  onGoRight: {
    keys: ['ArrowRight', 'l', ' '],
    description: _('Go Right / Next Page'),
    section: 'Navigation',
  },
  onGoUp: {
    keys: ['ArrowUp', 'k'],
    description: _('Go Up'),
    section: 'Navigation',
  },
  onGoDown: {
    keys: ['ArrowDown', 'j'],
    description: _('Go Down'),
    section: 'Navigation',
  },
  onGoNext: {
    keys: ['shift+j', 'shift+ArrowRight', 'shift+ArrowDown', 'PageDown'],
    description: _('Next Page'),
    section: 'Navigation',
  },
  onGoPrev: {
    keys: ['shift+k', 'shift+ArrowLeft', 'shift+ArrowUp', 'PageUp'],
    description: _('Previous Page'),
    section: 'Navigation',
  },
  onGoLeftSection: {
    keys: ['opt+ArrowLeft', 'alt+ArrowLeft'],
    description: _('Previous Chapter'),
    section: 'Navigation',
  },
  onGoRightSection: {
    keys: ['opt+ArrowRight', 'alt+ArrowRight'],
    description: _('Next Chapter'),
    section: 'Navigation',
  },
  onGoPrevSection: {
    keys: ['opt+ArrowUp', 'alt+ArrowUp'],
    description: _('Previous Chapter'),
    section: 'Navigation',
  },
  onGoNextSection: {
    keys: ['opt+ArrowDown', 'alt+ArrowDown'],
    description: _('Next Chapter'),
    section: 'Navigation',
  },
  onGoHalfPageDown: {
    keys: ['shift+ArrowDown', 'd'],
    description: _('Scroll Half Page Down'),
    section: 'Navigation',
  },
  onGoHalfPageUp: {
    keys: ['shift+ArrowUp', 'u'],
    description: _('Scroll Half Page Up'),
    section: 'Navigation',
  },
  onGoBack: {
    keys: ['shift+ArrowLeft', 'shift+h', 'alt+ArrowLeft'],
    description: _('Go Back'),
    section: 'Navigation',
  },
  onGoForward: {
    keys: ['shift+ArrowRight', 'shift+l', 'alt+ArrowRight'],
    description: _('Go Forward'),
    section: 'Navigation',
  },
  onZoomIn: {
    keys: ['ctrl+=', 'cmd+=', 'shift+='],
    description: _('Zoom In'),
    section: 'Zoom',
  },
  onZoomOut: {
    keys: ['ctrl+-', 'cmd+-', 'shift+-'],
    description: _('Zoom Out'),
    section: 'Zoom',
  },
  onResetZoom: {
    keys: ['ctrl+0', 'cmd+0'],
    description: _('Reset Zoom'),
    section: 'Zoom',
  },
  onSaveNote: {
    keys: ['ctrl+Enter'],
    description: _('Save Note'),
    section: '',
  },
  onEscape: {
    keys: ['Escape'],
    description: _('Close'),
    section: '',
  },
};

export type ShortcutConfig = {
  [K in keyof typeof DEFAULT_SHORTCUTS]: ShortcutEntry;
};

export const SHORTCUT_SECTIONS = [
  _('General'),
  _('Navigation'),
  _('Selection'),
  _('Zoom'),
  _('Window'),
] as const;

type ShortcutDisplayItem = {
  description: string;
  keys: string[];
};

type ShortcutDisplaySection = {
  section: string;
  items: ShortcutDisplayItem[];
};

export const getShortcutsForDisplay = (
  isMac: boolean,
  shortcuts: ShortcutConfig = loadShortcuts(),
): ShortcutDisplaySection[] => {
  return SHORTCUT_SECTIONS.map((section) => {
    const itemMap = new Map<string, ShortcutDisplayItem>();
    for (const [action, entry] of Object.entries(shortcuts)) {
      if (entry.section !== section) continue;
      const defaultKeys = DEFAULT_SHORTCUTS[action as keyof ShortcutConfig].keys;
      const isDefault =
        entry.keys.length === defaultKeys.length &&
        entry.keys.every((key, index) => key === defaultKeys[index]);
      const keys = isDefault ? filterPlatformKeys(entry.keys, isMac) : [...entry.keys];
      const existing = itemMap.get(entry.description);
      if (existing) {
        // Merge keys for entries with the same description
        for (const key of keys) {
          if (!existing.keys.includes(key)) {
            existing.keys.push(key);
          }
        }
      } else {
        itemMap.set(entry.description, { description: entry.description, keys });
      }
    }
    return { section, items: Array.from(itemMap.values()) };
  });
};

// Load shortcuts from localStorage or fallback to defaults
export const loadShortcuts = (): ShortcutConfig => {
  const result = Object.fromEntries(
    Object.entries(DEFAULT_SHORTCUTS).map(([key, entry]) => [
      key,
      { ...entry, keys: [...entry.keys] },
    ]),
  ) as ShortcutConfig;
  try {
    if (typeof localStorage === 'undefined') return result;
    const customShortcuts: unknown = JSON.parse(localStorage.getItem('customShortcuts') || '{}');
    if (!customShortcuts || typeof customShortcuts !== 'object' || Array.isArray(customShortcuts))
      return result;
    for (const [key, value] of Object.entries(customShortcuts)) {
      if (
        Object.hasOwn(result, key) &&
        Array.isArray(value) &&
        value.every((shortcut) => typeof shortcut === 'string' && isValidShortcut(shortcut))
      ) {
        const shortcutKey = key as keyof ShortcutConfig;
        result[shortcutKey] = { ...result[shortcutKey], keys: value };
      }
    }
  } catch {
    // A damaged or inaccessible preference must not disable keyboard navigation.
  }
  return result;
};

// Save custom shortcuts to localStorage
export const saveShortcuts = (shortcuts: ShortcutConfig) => {
  // Only persist the keys arrays to localStorage
  const keysOnly: Record<string, string[]> = {};
  for (const [key, entry] of Object.entries(shortcuts)) {
    keysOnly[key] = entry.keys;
  }
  localStorage.setItem('customShortcuts', JSON.stringify(keysOnly));
  window.dispatchEvent(new Event('shortcutUpdate'));
};
