const MODIFIER_MAP_MAC: Record<string, string> = {
  ctrl: '⌃',
  cmd: '⌘',
  alt: '⌥',
  opt: '⌥',
  shift: '⇧',
  meta: '⌘',
};

const MODIFIER_MAP_OTHER: Record<string, string> = {
  ctrl: 'Ctrl',
  cmd: 'Win',
  alt: 'Alt',
  opt: 'Alt',
  shift: 'Shift',
  meta: 'Win',
};

const MODIFIERS = new Set(['ctrl', 'cmd', 'alt', 'opt', 'shift', 'meta']);

const SPECIAL_KEYS: Record<string, string> = {
  arrowleft: '←',
  arrowright: '→',
  arrowup: '↑',
  arrowdown: '↓',
  escape: 'Esc',
  pagedown: 'PgDn',
  pageup: 'PgUp',
  ' ': 'Space',
  tab: 'Tab',
  enter: 'Enter',
};

const parseShortcut = (shortcut: string) => {
  const plusKey = shortcut === '+' || shortcut.endsWith('++');
  const prefix = shortcut.slice(0, -2);
  const parts = plusKey ? (prefix ? prefix.split('+') : []) : shortcut.split('+');
  const key = plusKey ? '+' : parts.pop();
  if (
    !key ||
    MODIFIERS.has(key.toLowerCase()) ||
    parts.some((part) => !MODIFIERS.has(part.toLowerCase()))
  ) {
    return null;
  }
  const modifiers = parts.map((part) => part.toLowerCase());
  return {
    modifiers,
    ctrlKey: modifiers.includes('ctrl'),
    altKey: modifiers.includes('alt') || modifiers.includes('opt'),
    metaKey: modifiers.includes('meta') || modifiers.includes('cmd'),
    shiftKey: modifiers.includes('shift'),
    key,
  };
};

export const isValidShortcut = (shortcut: string): boolean => parseShortcut(shortcut) !== null;

export const shortcutsEqual = (left: string, right: string): boolean => {
  const a = parseShortcut(left);
  const b = parseShortcut(right);
  return (
    a !== null &&
    b !== null &&
    a.key.toLowerCase() === b.key.toLowerCase() &&
    a.ctrlKey === b.ctrlKey &&
    a.altKey === b.altKey &&
    a.metaKey === b.metaKey &&
    a.shiftKey === b.shiftKey
  );
};

export const formatKeyForDisplay = (key: string, isMac: boolean): string => {
  const parsed = parseShortcut(key);
  if (!parsed) return key;
  const modMap = isMac ? MODIFIER_MAP_MAC : MODIFIER_MAP_OTHER;
  const modifiers = parsed.modifiers.map((modifier) => modMap[modifier]!);
  const baseKey = parsed.key;

  // Map special keys or capitalize single characters
  const lowerBase = baseKey.toLowerCase();
  let displayKey: string;
  if (SPECIAL_KEYS[lowerBase]) {
    displayKey = SPECIAL_KEYS[lowerBase]!;
  } else if (baseKey.length === 1 && baseKey >= 'a' && baseKey <= 'z') {
    displayKey = baseKey.toUpperCase();
  } else {
    displayKey = baseKey;
  }

  if (isMac) {
    return [...modifiers, displayKey].join('');
  }
  return [...modifiers, displayKey].join('+');
};

export type ShortcutEventLike = Pick<
  KeyboardEvent,
  'key' | 'ctrlKey' | 'altKey' | 'metaKey' | 'shiftKey'
>;

export const eventToShortcut = (
  event: ShortcutEventLike & { isComposing?: boolean },
): string | null => {
  const ignoredKeys = [
    'control',
    'meta',
    'alt',
    'shift',
    'altgraph',
    'capslock',
    'fn',
    'fnlock',
    'dead',
    'unidentified',
    'process',
  ];
  if (event.isComposing || !event.key || ignoredKeys.includes(event.key.toLowerCase())) return null;
  const modifiers = [
    event.ctrlKey ? 'ctrl' : '',
    event.metaKey ? 'cmd' : '',
    event.altKey ? 'opt' : '',
    event.shiftKey ? 'shift' : '',
  ].filter(Boolean);
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  return [...modifiers, key].join('+');
};

// Whether a keyboard event matches any of the given shortcut strings. `alt`/`opt`
// and `cmd`/`meta` are treated as equivalent, matching how shortcuts are authored.
export const matchesShortcut = (event: ShortcutEventLike, keys: string[]): boolean => {
  const key = event.key.toLowerCase();
  return keys.some((shortcut) => {
    const parsed = parseShortcut(shortcut);
    return (
      parsed !== null &&
      parsed.key.toLowerCase() === key &&
      parsed.ctrlKey === event.ctrlKey &&
      parsed.altKey === event.altKey &&
      parsed.metaKey === event.metaKey &&
      parsed.shiftKey === event.shiftKey
    );
  });
};

const MAC_MODIFIERS = new Set(['cmd', 'opt']);
const OTHER_MODIFIERS = new Set(['ctrl', 'alt']);

const hasModifier = (key: string, modifiers: Set<string>): boolean => {
  const parts = key.split('+');
  return parts.some((p) => modifiers.has(p.toLowerCase()));
};

export const filterPlatformKeys = (keys: string[], isMac: boolean): string[] => {
  const preferred = isMac ? MAC_MODIFIERS : OTHER_MODIFIERS;
  const excluded = isMac ? OTHER_MODIFIERS : MAC_MODIFIERS;

  const platformKeys = keys.filter((k) => hasModifier(k, preferred));
  const agnosticKeys = keys.filter((k) => !hasModifier(k, preferred) && !hasModifier(k, excluded));

  if (platformKeys.length > 0 || agnosticKeys.length > 0) {
    return [...agnosticKeys, ...platformKeys];
  }

  // Fallback: return all keys if none match
  return keys;
};
