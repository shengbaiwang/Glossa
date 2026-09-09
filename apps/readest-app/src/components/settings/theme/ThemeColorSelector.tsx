import React, { useEffect, useId, useState } from 'react';
import { Check, ChevronDown, Plus } from '@/components/GlossaIcons';
import { Theme } from '@/styles/themes';
import { useTranslation } from '@/hooks/useTranslation';
import { SectionTitle } from '../primitives';

interface ThemeColorSelectorProps {
  themes: Theme[];
  themeColor: string;
  isDarkMode: boolean;
  onThemeColorChange: (name: string) => void;
  onEditTheme: (name: string) => void;
  onCreateTheme: () => void;
  'data-setting-id'?: string;
}

const featuredNames = ['default', 'darkreader', 'sepia', 'grass', 'nord', 'contrast'];

const ThemeColorSelector: React.FC<ThemeColorSelectorProps> = ({
  themes,
  themeColor,
  isDarkMode,
  onThemeColorChange,
  onEditTheme,
  onCreateTheme,
  'data-setting-id': settingId,
}) => {
  const _ = useTranslation();
  const groupId = useId();
  const selected = themes.find((theme) => theme.name === themeColor) ?? themes[0];
  const featured = featuredNames.flatMap((name) => themes.filter((theme) => theme.name === name));
  const additional = themes.filter(
    (theme) => !featuredNames.includes(theme.name) && !theme.isCustomizable,
  );
  const custom = themes.filter((theme) => theme.isCustomizable);
  const hasAdditionalSelection = additional.some((theme) => theme.name === themeColor);
  const [showMore, setShowMore] = useState(hasAdditionalSelection);
  const mode = isDarkMode ? 'dark' : 'light';
  const palette = selected?.colors[mode];

  useEffect(() => {
    if (hasAdditionalSelection) setShowMore(true);
  }, [themeColor, hasAdditionalSelection]);

  const renderChoice = ({ name, label, colors }: Theme) => {
    const colorsForMode = colors[mode];
    return (
      <label key={name} className='glossa-theme-choice'>
        <input
          className='sr-only'
          type='radio'
          name={groupId}
          value={name}
          aria-label={_(label)}
          checked={themeColor === name}
          onChange={() => onThemeColorChange(name)}
          onKeyDownCapture={(event) => {
            // Keep reading shortcuts out of the native radio keyboard interaction.
            if (
              ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', 'Enter'].includes(event.key)
            ) {
              event.stopPropagation();
            }
            if (event.key === 'Enter') {
              event.preventDefault();
              onThemeColorChange(name);
            }
          }}
        />
        <span
          className='glossa-theme-swatch'
          style={{
            backgroundColor: colorsForMode['base-100'],
            color: colorsForMode['base-content'],
          }}
        >
          <span className='glossa-theme-specimen' aria-hidden='true'>
            Aa
          </span>
          {themeColor === name && (
            <span
              className='glossa-theme-check'
              style={{
                backgroundColor: colorsForMode['base-content'],
                color: colorsForMode['base-100'],
              }}
              aria-hidden='true'
            >
              <Check size={13} />
            </span>
          )}
        </span>
        <span className='glossa-theme-name'>{_(label)}</span>
      </label>
    );
  };

  return (
    <div className='glossa-theme-selector' data-setting-id={settingId}>
      <div className='glossa-theme-heading'>
        <SectionTitle id={`${groupId}-label`}>{_('Theme Color')}</SectionTitle>
        <button type='button' className='glossa-button' onClick={onCreateTheme}>
          <Plus size={16} aria-hidden='true' />
          {_('Custom Theme')}
        </button>
      </div>
      {selected && palette && (
        <section
          aria-label={_('Reading preview')}
          className='glossa-theme-preview'
          style={{ backgroundColor: palette['base-100'], color: palette['base-content'] }}
        >
          <div className='glossa-theme-preview-caption'>
            <span>{_(selected.label)}</span>
            <span className='glossa-theme-mode'>
              {isDarkMode ? _('Dark Mode') : _('Light Mode')}
            </span>
          </div>
          <p>{_('A quiet page, a clear mind.')}</p>
          <span className='glossa-theme-preview-accent' style={{ color: palette.primary }}>
            {_('Read at your own pace.')}
          </span>
        </section>
      )}
      <div role='radiogroup' aria-labelledby={`${groupId}-label`}>
        <div className='glossa-theme-grid'>{featured.map(renderChoice)}</div>
        {additional.length > 0 && (
          <>
            <button
              type='button'
              className='glossa-button glossa-theme-more'
              aria-expanded={showMore}
              aria-controls={`${groupId}-more`}
              onClick={() => setShowMore(!showMore)}
            >
              {showMore ? _('Fewer colors') : _('More colors')}
              <ChevronDown size={16} className={showMore ? 'rotate-180' : ''} aria-hidden='true' />
            </button>
            <div id={`${groupId}-more`} hidden={!showMore}>
              <div className='glossa-theme-grid'>{additional.map(renderChoice)}</div>
            </div>
          </>
        )}
        {custom.length > 0 && (
          <div className='glossa-theme-custom'>
            <div className='glossa-theme-heading'>
              <SectionTitle>{_('Custom')}</SectionTitle>
              {selected?.isCustomizable && (
                <button
                  type='button'
                  className='glossa-button'
                  onClick={() => onEditTheme(selected.name)}
                >
                  {_('Edit')}
                </button>
              )}
            </div>
            <div className='glossa-theme-grid'>{custom.map(renderChoice)}</div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ThemeColorSelector;
