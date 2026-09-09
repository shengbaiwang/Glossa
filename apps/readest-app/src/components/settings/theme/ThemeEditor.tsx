import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from '@/hooks/useTranslation';
import { CustomTheme, Theme, themes } from '@/styles/themes';
import { md5Fingerprint } from '@/utils/md5';
import { useSettingsStore } from '@/store/settingsStore';
import BoxedList from '../primitives/BoxedList';
import SettingsRow from '../primitives/SettingsRow';
import ColorInput from './ColorInput';

type ThemeEditorProps = {
  customTheme: CustomTheme | null;
  baseTheme?: Theme;
  onSave: (customTheme: CustomTheme) => void | Promise<void>;
  onDelete: (customTheme: CustomTheme) => void | Promise<void>;
  onCancel: () => void;
};

const ThemeEditor: React.FC<ThemeEditorProps> = ({
  customTheme,
  baseTheme = themes[0]!,
  onSave,
  onDelete,
  onCancel,
}) => {
  const _ = useTranslation();
  const { settings } = useSettingsStore();
  const nameId = useId();
  const errorId = useId();
  const [colors, setColors] = useState<CustomTheme['colors']>(
    () =>
      customTheme?.colors ?? {
        light: {
          fg: baseTheme.colors.light['base-content'],
          bg: baseTheme.colors.light['base-100'],
          primary: baseTheme.colors.light.primary,
        },
        dark: {
          fg: baseTheme.colors.dark['base-content'],
          bg: baseTheme.colors.dark['base-100'],
          primary: baseTheme.colors.dark.primary,
        },
      },
  );
  const [themeName, setThemeName] = useState(customTheme?.label ?? _('Custom'));
  const [isBusy, setIsBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const trimmedName = themeName.trim();
  // Existing IDs are referenced by saved reader settings, so renaming only
  // changes the display label. New themes retain the existing ID convention.
  const themeId = customTheme?.name ?? md5Fingerprint(trimmedName);
  const hasNameConflict = settings.globalReadSettings.customThemes.some(
    (theme) =>
      theme.name !== customTheme?.name &&
      (theme.label.trim().toLowerCase() === trimmedName.toLowerCase() || theme.name === themeId),
  );
  const nameError = !trimmedName
    ? _('Enter a theme name.')
    : hasNameConflict
      ? _('A theme with this name already exists.')
      : null;

  const handleSave = async () => {
    if (nameError || isBusy) return;
    setIsBusy(true);
    setActionError(null);
    try {
      await onSave({ name: themeId, label: trimmedName, colors });
    } catch {
      setActionError(_('Could not save the theme. Try again.'));
    } finally {
      setIsBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!customTheme || isBusy) return;
    setIsBusy(true);
    setActionError(null);
    try {
      await onDelete(customTheme);
    } catch {
      setActionError(_('Could not delete the theme. Try again.'));
    } finally {
      setIsBusy(false);
    }
  };

  // Keep actions outside the dialog's scroll viewport so the preview cards
  // cannot slide underneath the footer on fractional-DPR screens.
  const rootRef = useRef<HTMLDivElement>(null);
  const [footerContainer, setFooterContainer] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setFooterContainer(rootRef.current?.closest<HTMLElement>('.modal-box') ?? null);
  }, []);

  const footer = (
    <div className='glossa-theme-editor-footer bg-base-200 flex shrink-0 items-center justify-end gap-2 px-6 py-3 sm:px-[10%]'>
      {customTheme && (
        <button
          type='button'
          className='glossa-button eink-bordered me-auto min-h-11 text-error'
          disabled={isBusy}
          onClick={handleDelete}
        >
          {_('Delete')}
        </button>
      )}
      <button
        type='button'
        className='glossa-button eink-bordered min-h-11'
        disabled={isBusy}
        onClick={onCancel}
      >
        {_('Cancel')}
      </button>
      <button
        type='button'
        className='glossa-button glossa-button-primary min-h-11'
        disabled={!!nameError || isBusy}
        onClick={handleSave}
      >
        {_('Save')}
      </button>
    </div>
  );

  return (
    <div
      ref={rootRef}
      className='glossa-theme-editor mt-5 flex min-w-0 flex-col gap-5'
      aria-busy={isBusy}
    >
      <div>
        <BoxedList>
          <SettingsRow label={<label htmlFor={nameId}>{_('Theme Name')}</label>}>
            <input
              id={nameId}
              type='text'
              value={themeName}
              disabled={isBusy}
              onChange={(event) => setThemeName(event.target.value)}
              aria-invalid={!!nameError}
              aria-describedby={nameError ? errorId : undefined}
              className='settings-content eink-bordered border-base-300 bg-base-100 text-base-content focus-visible:ring-base-content/20 min-h-11 min-w-0 flex-1 rounded-xl border px-3 focus-visible:outline-none focus-visible:ring-2'
              placeholder={_('Custom Theme')}
            />
          </SettingsRow>
        </BoxedList>
        {nameError && (
          <p id={errorId} role='alert' className='text-error mt-2 px-1 text-[0.85em]'>
            {nameError}
          </p>
        )}
        {actionError && (
          <p role='alert' className='text-error mt-2 px-1 text-[0.85em]'>
            {actionError}
          </p>
        )}
      </div>

      <div className='grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] gap-5'>
        {(['light', 'dark'] as const).map((mode) => {
          const modeLabel = mode === 'light' ? _('Light Mode') : _('Dark Mode');
          const palette = colors[mode];
          return (
            <fieldset key={mode} aria-label={modeLabel} className='min-w-0' disabled={isBusy}>
              <BoxedList title={modeLabel}>
                {(
                  [
                    ['fg', _('Text Color')],
                    ['bg', _('Background Color')],
                    ['primary', _('Link Color')],
                  ] as const
                ).map(([field, label]) => (
                  <SettingsRow key={field} label={label}>
                    <div className='flex shrink-0 items-center gap-2'>
                      <span className='text-neutral-content font-mono text-[0.75em]'>
                        {palette[field].toUpperCase()}
                      </span>
                      <div className='[&_button]:h-11 [&_button]:w-11 [&_button]:rounded-xl [&_button]:shadow-none [&_button]:transition-colors [&_button:hover]:scale-100'>
                        <ColorInput
                          label={`${modeLabel}: ${label}`}
                          value={palette[field]}
                          onChange={(value) =>
                            setColors((current) => ({
                              ...current,
                              [mode]: { ...current[mode], [field]: value },
                            }))
                          }
                          pickerPosition='right'
                        />
                      </div>
                    </div>
                  </SettingsRow>
                ))}
              </BoxedList>
              <div
                role='region'
                aria-label={`${modeLabel}: ${_('Preview')}`}
                className='glossa-theme-preview glossa-theme-editor-preview'
                style={{ backgroundColor: palette.bg, color: palette.fg }}
              >
                <p>{_('A quiet page, a little time, and room to think.')}</p>
                <span className='glossa-theme-preview-accent' style={{ color: palette.primary }}>
                  {_('Sample Link')}
                </span>
              </div>
            </fieldset>
          );
        })}
      </div>
      {footerContainer ? createPortal(footer, footerContainer) : footer}
    </div>
  );
};

export default ThemeEditor;
