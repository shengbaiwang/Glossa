import { useRef, useState } from 'react';
import { Plus, RotateCcw, X } from '@/components/GlossaIcons';
import {
  DEFAULT_SHORTCUTS,
  type ShortcutConfig,
  saveShortcuts,
  loadShortcuts,
} from '@/helpers/shortcuts';
import { useShortcutConfig } from '@/hooks/useShortcuts';
import { useTranslation } from '@/hooks/useTranslation';
import { isMacPlatform } from '@/services/environment';
import {
  eventToShortcut,
  formatKeyForDisplay,
  matchesShortcut,
  shortcutsEqual,
} from '@/utils/shortcutKeys';
import BoxedList from './primitives/BoxedList';
import SettingsRow from './primitives/SettingsRow';

type Action = keyof ShortcutConfig;
type Changes = Partial<Record<Action, string[]>>;
type Recording = { action: Action; index: number | null; keys: string[] };

export default function ShortcutsPanel() {
  const _ = useTranslation();
  const stored = useShortcutConfig();
  const isMac = isMacPlatform();
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<Changes>({});
  const [recording, setRecording] = useState<Recording | null>(null);
  const [error, setError] = useState('');
  const [saveFailed, setSaveFailed] = useState(false);
  const [undo, setUndo] = useState<{ before: Changes; after: Changes } | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const pendingBase = useRef<Changes>({});
  const config = { ...stored };
  for (const action of Object.keys(draft) as Action[]) {
    config[action] = { ...config[action], keys: draft[action]! };
  }

  const persist = (changes: Changes): boolean => {
    const pending = { ...draft, ...changes };
    // Re-read before every save so a retry only replaces this page's edited actions.
    const next = loadShortcuts();
    const retainDraft = (message: string) => {
      setDraft(pending);
      setSaveFailed(true);
      setError(message);
      return false;
    };
    for (const action of Object.keys(changes) as Action[]) {
      pendingBase.current[action] ??= [...next[action].keys];
    }
    for (const action of Object.keys(pending) as Action[]) {
      if (JSON.stringify(next[action].keys) !== JSON.stringify(pendingBase.current[action])) {
        return retainDraft(_('Shortcuts changed in another window'));
      }
    }
    for (const action of Object.keys(pending) as Action[]) {
      next[action] = { ...next[action], keys: pending[action]! };
    }
    for (const action of Object.keys(pending) as Action[]) {
      for (const key of pending[action]!) {
        // Existing/default overlaps express reader contexts. Only new custom bindings need checking.
        if (
          [...pendingBase.current[action]!, ...DEFAULT_SHORTCUTS[action].keys].some((old) =>
            shortcutsEqual(old, key),
          )
        )
          continue;
        const conflict = (Object.keys(next) as Action[]).find(
          (other) =>
            other !== action && next[other].keys.some((otherKey) => shortcutsEqual(otherKey, key)),
        );
        if (conflict)
          return retainDraft(
            _('Shortcut already used by {{action}}', { action: _(next[conflict].description) }),
          );
      }
    }
    try {
      saveShortcuts(next);
      pendingBase.current = {};
      setDraft({});
      setSaveFailed(false);
      setError('');
      return true;
    } catch {
      setDraft(pending);
      setSaveFailed(true);
      setError('');
      return false;
    }
  };

  const cancelRecording = () => {
    setRecording(null);
    if (!saveFailed) setError('');
    trigger.current?.focus();
  };

  const updateKeys = (action: Action, keys: string[]) => {
    setUndo(null);
    persist({ [action]: keys });
  };

  const focusAddButton = (element: HTMLElement) => {
    element
      .closest('[data-setting-id]')
      ?.querySelector<HTMLButtonElement>('[data-add-shortcut]')
      ?.focus();
  };

  const beginRecording = (button: HTMLButtonElement, action: Action, index: number | null) => {
    trigger.current = button;
    if (!saveFailed) setError('');
    setRecording({ action, index, keys: [...config[action].keys] });
  };

  const restoreAll = () => {
    const before: Changes = {};
    const after: Changes = {};
    for (const action of Object.keys(config) as Action[]) {
      if (!config[action].section) continue;
      before[action] = config[action].keys;
      after[action] = [...DEFAULT_SHORTCUTS[action].keys];
    }
    if (persist(after)) setUndo({ before, after });
  };

  const query = search.trim().toLocaleLowerCase();
  const sections = [...new Set(Object.values(config).map((entry) => entry.section))]
    .filter(Boolean)
    .map((section) => ({
      section,
      actions: (Object.keys(config) as Action[]).filter((action) => {
        const entry = config[action];
        return (
          entry.section === section &&
          [
            _(entry.description),
            entry.description,
            _(section),
            ...entry.keys.map((key) => formatKeyForDisplay(key, isMac)),
          ].some((text) => text.toLocaleLowerCase().includes(query))
        );
      }),
    }))
    .filter((section) => section.actions.length > 0);

  return (
    <div className='flex min-w-0 flex-col gap-5' data-setting-id='settings.shortcuts.bindings'>
      <div className='flex flex-wrap items-center gap-3'>
        <input
          type='search'
          aria-label={_('Search shortcuts')}
          placeholder={_('Search shortcuts')}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className='input eink-bordered h-11 min-w-0 flex-1 text-sm'
        />
        <button
          type='button'
          className='btn btn-ghost eink-bordered min-h-11 h-auto py-2 text-sm'
          onClick={restoreAll}
        >
          <RotateCcw size={16} />
          {_('Restore All Defaults')}
        </button>
      </div>
      {(error || saveFailed) && (
        <div role='alert' className='flex flex-wrap items-center gap-3 text-sm'>
          <span>{error || _('Could not save shortcuts')}</span>
          {saveFailed && (
            <>
              <button
                type='button'
                className='btn btn-ghost btn-sm eink-bordered min-h-11'
                onClick={() => persist({})}
              >
                {_('Retry')}
              </button>
              <button
                type='button'
                className='btn btn-ghost btn-sm eink-bordered min-h-11'
                onClick={() => {
                  pendingBase.current = {};
                  setDraft({});
                  setSaveFailed(false);
                  setError('');
                  setUndo(null);
                  window.dispatchEvent(new Event('shortcutUpdate'));
                }}
              >
                {_('Discard changes')}
              </button>
            </>
          )}
        </div>
      )}
      {undo && (
        <div role='status' className='flex items-center gap-3 text-sm'>
          <span>{_('Shortcuts restored')}</span>
          <button
            type='button'
            className='btn btn-ghost btn-sm eink-bordered min-h-11'
            onClick={() => {
              const latest = loadShortcuts();
              const changes: Changes = {};
              for (const action of Object.keys(undo.before) as Action[]) {
                if (JSON.stringify(latest[action].keys) === JSON.stringify(undo.after[action]))
                  changes[action] = undo.before[action];
              }
              if (persist(changes)) setUndo(null);
            }}
          >
            {_('Undo')}
          </button>
        </div>
      )}
      {sections.length === 0 && <p className='glossa-supporting-text'>{_('No results found')}</p>}
      {sections.map(({ section, actions }) => (
        <BoxedList key={section} title={_(section)}>
          {actions.map((action) => {
            const entry = config[action];
            const label = _(entry.description);
            const changed =
              JSON.stringify(entry.keys) !== JSON.stringify(DEFAULT_SHORTCUTS[action].keys);
            return (
              <SettingsRow
                key={action}
                label={label}
                data-setting-id={`settings.shortcuts.${action}`}
                className='flex-wrap py-2'
              >
                <div className='flex min-w-0 flex-wrap items-center justify-end gap-1.5'>
                  {entry.keys.map((key, index) => (
                    <span
                      key={`binding:${index}`}
                      className='eink-bordered border-base-content/15 inline-flex min-h-11 max-w-full items-center rounded-md border'
                    >
                      <button
                        type='button'
                        className='min-h-11 min-w-11 break-all px-2 text-sm'
                        aria-label={_('Change shortcut {{key}}', {
                          key: formatKeyForDisplay(key, isMac),
                        })}
                        onClick={(event) => beginRecording(event.currentTarget, action, index)}
                      >
                        <kbd dir='ltr'>{formatKeyForDisplay(key, isMac)}</kbd>
                      </button>
                      <button
                        type='button'
                        className='glossa-icon-button !h-11 !w-11 !min-h-11 !min-w-11'
                        aria-label={_('Remove shortcut {{key}}', {
                          key: formatKeyForDisplay(key, isMac),
                        })}
                        onClick={(event) => {
                          focusAddButton(event.currentTarget);
                          updateKeys(
                            action,
                            entry.keys.filter((_, position) => position !== index),
                          );
                        }}
                      >
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                  {entry.keys.length === 0 && (
                    <span className='glossa-supporting-text'>{_('Not assigned')}</span>
                  )}
                  {recording?.action === action && (
                    <input
                      autoFocus
                      readOnly
                      value=''
                      data-shortcut-recorder='true'
                      aria-label={_('Press a shortcut')}
                      placeholder={_('Press keys…')}
                      title={_('Esc to cancel')}
                      className='input eink-bordered h-11 w-36 max-w-full text-sm'
                      onBlur={() => {
                        setRecording(null);
                      }}
                      onKeyDown={(event) => {
                        event.stopPropagation();
                        if (event.key === 'Tab') return;
                        event.preventDefault();
                        if (event.nativeEvent.isComposing || event.repeat) return;
                        if (event.key === 'Escape') {
                          cancelRecording();
                          return;
                        }
                        if (event.key === 'Backspace') {
                          setError(_('This key is reserved'));
                          return;
                        }
                        const key = eventToShortcut(event);
                        if (!key) return;
                        const currentKeys = draft[action] ?? loadShortcuts()[action].keys;
                        if (JSON.stringify(currentKeys) !== JSON.stringify(recording.keys)) {
                          cancelRecording();
                          setError(_('Shortcuts changed in another window'));
                          return;
                        }
                        if (
                          recording.index !== null &&
                          matchesShortcut(event, [entry.keys[recording.index]!])
                        ) {
                          cancelRecording();
                          return;
                        }
                        const conflict = (Object.keys(config) as Action[]).find((other) =>
                          matchesShortcut(event, config[other].keys),
                        );
                        if (conflict) {
                          setError(
                            _('Shortcut already used by {{action}}', {
                              action: _(config[conflict].description),
                            }),
                          );
                          return;
                        }
                        const keys = [...entry.keys];
                        if (recording.index === null) keys.push(key);
                        else keys[recording.index] = key;
                        updateKeys(action, keys);
                        setRecording(null);
                        trigger.current?.focus();
                      }}
                    />
                  )}
                  <button
                    type='button'
                    data-add-shortcut={action}
                    className='glossa-icon-button !h-11 !w-11 !min-h-11 !min-w-11'
                    aria-label={_('Add shortcut for {{action}}', { action: label })}
                    title={_('Add shortcut')}
                    onClick={(event) => beginRecording(event.currentTarget, action, null)}
                  >
                    <Plus size={14} />
                  </button>
                  {changed && (
                    <button
                      type='button'
                      className='glossa-icon-button !h-11 !w-11 !min-h-11 !min-w-11'
                      aria-label={_('Restore {{action}}', { action: label })}
                      title={_('Restore Defaults')}
                      onClick={(event) => {
                        focusAddButton(event.currentTarget);
                        updateKeys(action, [...DEFAULT_SHORTCUTS[action].keys]);
                      }}
                    >
                      <RotateCcw size={14} />
                    </button>
                  )}
                </div>
              </SettingsRow>
            );
          })}
        </BoxedList>
      ))}
    </div>
  );
}
