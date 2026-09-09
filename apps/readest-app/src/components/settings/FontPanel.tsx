import React, { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, Minus, Plus, RotateCcw } from 'lucide-react';
import {
  CJK_EXCLUDE_PATTENS,
  CJK_FONTS_PATTENS,
  CJK_SANS_SERIF_FONTS,
  CJK_SERIF_FONTS,
  IOS_FONTS,
  LINUX_FONTS,
  MACOS_FONTS,
  MONOSPACE_FONTS,
  SANS_SERIF_FONTS,
  SERIF_FONTS,
  WINDOWS_FONTS,
  DEFAULT_BOOK_FONT,
} from '@/services/constants';
import { mountAdditionalFonts } from '@/styles/fonts';
import {
  buildFontFamilyLists,
  getReadingFontFamily,
  resolveReadingFont,
  isRemovedReadingFont,
} from '@/styles/readingFonts';
import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useCustomFontStore } from '@/store/customFontStore';
import { getOSPlatform, getLocale } from '@/utils/misc';
import { getSysFontsList } from '@/utils/bridge';
import { isCJKStr } from '@/utils/lang';
import { getFontPreviewSample } from '@/utils/fontPreview';
import { isTauriAppPlatform } from '@/services/environment';
import { useKeyDownActions } from '@/hooks/useKeyDownActions';
import { saveViewSettings } from '@/helpers/settings';
import type { BookFont } from '@/types/book';
import type { SettingsPanelPanelProp } from './SettingsDialog';
import { BoxedList } from './primitives';
import FontPicker from './FontPicker';
import CustomFonts from './CustomFonts';

type FontValues = Omit<BookFont, 'minimumFontSize'> & { overrideFont: boolean };
const FONT_KEYS = [
  ...Object.keys(DEFAULT_BOOK_FONT).filter((key) => key !== 'minimumFontSize'),
  'overrideFont',
] as (keyof FontValues)[];
const isSymbolicFont = (font: string) =>
  /emoji|icons|symbol|dingbats|ornaments|webdings|wingdings|miuiex/i.test(font);

function FontNumber({
  label,
  value,
  min,
  max,
  onChange,
  settingId,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  settingId?: string;
}) {
  const _ = useTranslation();
  const id = useId();
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = (number: number) => {
    const next = Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : value;
    setDraft(String(next));
    if (next !== value) onChange(next);
  };
  return (
    <div className='glossa-font-number' data-setting-id={settingId}>
      <label htmlFor={id}>{label}</label>
      <div className='glossa-font-stepper eink-bordered'>
        <button
          type='button'
          className='glossa-icon-button'
          aria-label={`${_('Decrease')} ${label}`}
          disabled={value <= min}
          onClick={() => commit(value - 1)}
        >
          <Minus size={16} />
        </button>
        <input
          id={id}
          type='number'
          min={min}
          max={max}
          step={1}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => commit(draft.trim() === '' ? value : Number(draft))}
          onKeyDownCapture={(event) => {
            if (event.key === 'Enter') {
              event.stopPropagation();
              event.preventDefault();
              event.currentTarget.blur();
            }
            if (event.key === 'Escape') {
              event.stopPropagation();
              setDraft(String(value));
            }
          }}
        />
        <button
          type='button'
          className='glossa-icon-button'
          aria-label={`${_('Increase')} ${label}`}
          disabled={value >= max}
          onClick={() => commit(value + 1)}
        >
          <Plus size={16} />
        </button>
      </div>
    </div>
  );
}

const FontPanel: React.FC<SettingsPanelPanelProp> = ({ bookKey, onRegisterReset }) => {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
  const { getView, getViewSettings } = useReaderStore();
  const { settings, fontPanelView, setFontPanelView, activeSettingsItemId } = useSettingsStore();
  const { getFontFamilies } = useCustomFontStore();
  const stored = getViewSettings(bookKey) || settings.globalViewSettings;
  const view = getView(bookKey);
  const imported = getFontFamilies();
  const importedKey = imported.join('\0');
  const previousImported = useRef([...imported]);
  const normalize = (): FontValues => ({
    ...DEFAULT_BOOK_FONT,
    ...stored,
    overrideFont: stored.overrideFont ?? false,
    serifFont: resolveReadingFont(stored.serifFont, 'Times New Roman', imported),
    sansSerifFont: resolveReadingFont(stored.sansSerifFont, 'Arial', imported),
    monospaceFont: resolveReadingFont(stored.monospaceFont, 'Courier New', imported),
    defaultCJKFont: resolveReadingFont(stored.defaultCJKFont, 'Auto', imported),
  });
  const [values, setValues] = useState<FontValues>(normalize);
  const valuesRef = useRef(values);
  valuesRef.current = values;
  const [failed, setFailed] = useState<Partial<FontValues> | null>(null);
  const [more, setMore] = useState(false);
  const advancedId = useId();
  const platformFonts: Record<string, string[]> = {
    macos: MACOS_FONTS,
    windows: WINDOWS_FONTS,
    linux: LINUX_FONTS,
    ios: IOS_FONTS,
  };
  const [sysFonts, setSysFonts] = useState(() => platformFonts[getOSPlatform()] ?? []);
  const [fontLoadError, setFontLoadError] = useState(false);
  const [fontLoadAttempt, setFontLoadAttempt] = useState(0);
  const [scope, setScope] = useState(stored.isGlobal ?? true);
  const [failedScope, setFailedScope] = useState<boolean | null>(null);
  const writeQueue = useRef(Promise.resolve());
  const writeRevision = useRef(0);
  const pendingValues = useRef<Partial<FontValues>>({});
  const pendingScope = useRef<boolean | null>(null);
  const failedValues = useRef<Partial<FontValues>>({});
  const scopeFailure = useRef<boolean | null>(null);

  // Store writes capture whole settings snapshots. Keep their completion order
  // consistent with clicks, including a scope change between two font choices.
  const enqueue = (write: () => Promise<void>) => {
    const revision = ++writeRevision.current;
    writeQueue.current = writeQueue.current.then(write).then(() => {
      if (revision !== writeRevision.current) return;
      setFailed(Object.keys(failedValues.current).length ? { ...failedValues.current } : null);
      setFailedScope(scopeFailure.current);
    });
    return writeQueue.current;
  };
  const saveScope = (global: boolean, retry = false) => {
    setScope(global);
    pendingScope.current = global;
    return enqueue(async () => {
      try {
        if (retry)
          await saveViewSettings(envConfig, bookKey, 'isGlobal', global, true, false, true);
        else await saveViewSettings(envConfig, bookKey, 'isGlobal', global, true, false);
        scopeFailure.current = null;
        if (pendingScope.current === global) pendingScope.current = null;
      } catch {
        scopeFailure.current = global;
      }
    });
  };
  const persist = (patch: Partial<FontValues>, retry = false) => {
    Object.assign(pendingValues.current, patch);
    return enqueue(async () => {
      for (const key of FONT_KEYS) {
        const value = patch[key];
        if (value === undefined) continue;
        const discardDeletedFont = () => {
          if (
            typeof value !== 'string' ||
            !imported.includes(value) ||
            getFontFamilies().includes(value)
          )
            return false;
          if (pendingValues.current[key] === value) delete pendingValues.current[key];
          if (failedValues.current[key] === value) delete failedValues.current[key];
          return true;
        };
        if (discardDeletedFont()) continue;
        try {
          if (retry) await saveViewSettings(envConfig, bookKey, key, value, false, true, true);
          else await saveViewSettings(envConfig, bookKey, key, value);
          delete failedValues.current[key];
          if (pendingValues.current[key] === value) delete pendingValues.current[key];
        } catch {
          // Font management can remove this selection while its disk write is pending.
          if (!discardDeletedFont()) Object.assign(failedValues.current, { [key]: value });
        }
      }
    });
  };
  const change = (patch: Partial<FontValues>) => {
    const changes: Partial<FontValues> = {};
    for (const key of FONT_KEYS) {
      const next = patch[key];
      if (next !== undefined && next !== valuesRef.current[key])
        Object.assign(changes, { [key]: next });
    }
    if (!Object.keys(changes).length) return;
    valuesRef.current = { ...valuesRef.current, ...changes };
    setValues(valuesRef.current);
    void persist(changes);
  };
  const handleReset = () => {
    const defaults = appService?.getDefaultViewSettings();
    if (!defaults) return;
    const patch: Partial<FontValues> = {};
    for (const key of FONT_KEYS) Object.assign(patch, { [key]: defaults[key] });
    change(patch);
  };
  const resetRef = useRef(handleReset);
  resetRef.current = handleReset;
  useEffect(() => {
    onRegisterReset(() => resetRef.current());
  }, []);

  useEffect(() => {
    mountAdditionalFonts(document);
  }, []);

  // React to font deletion, settings sync and switching books. Only obsolete selections
  // need a migration write; merely opening this panel must not publish unchanged settings.
  useEffect(() => {
    const next = normalize();
    const deleted = previousImported.current.filter((font) => !imported.includes(font));
    previousImported.current = [...imported];
    if (deleted.length) {
      for (const key of [
        'serifFont',
        'sansSerifFont',
        'monospaceFont',
        'defaultCJKFont',
      ] as const) {
        if (deleted.includes(pendingValues.current[key] ?? '')) {
          delete pendingValues.current[key];
          delete failedValues.current[key];
        }
      }
      setFailed(Object.keys(failedValues.current).length ? { ...failedValues.current } : null);
    }
    setValues({ ...next, ...pendingValues.current });
    setScope(pendingScope.current ?? stored.isGlobal ?? true);
    const migrated: Partial<FontValues> = {};
    for (const key of ['serifFont', 'sansSerifFont', 'monospaceFont', 'defaultCJKFont'] as const) {
      if (next[key] !== stored[key] && pendingValues.current[key] !== next[key])
        migrated[key] = next[key];
    }
    if (Object.keys(migrated).length) void persist(migrated);
  }, [
    bookKey,
    stored.defaultFont,
    stored.defaultFontSize,
    stored.fontWeight,
    stored.overrideFont,
    stored.serifFont,
    stored.sansSerifFont,
    stored.monospaceFont,
    stored.defaultCJKFont,
    stored.isGlobal,
    importedKey,
  ]);

  useEffect(() => {
    if (!activeSettingsItemId?.startsWith('settings.font.')) return;
    setFontPanelView('main-fonts');
    if (activeSettingsItemId === 'settings.font.monospaceFont') setMore(true);
  }, [activeSettingsItemId, setFontPanelView]);

  useKeyDownActions({
    enabled: fontPanelView === 'custom-fonts',
    onCancel: () => setFontPanelView('main-fonts'),
  });

  useEffect(() => {
    if (!isTauriAppPlatform() || !appService || appService.isAndroidApp) return;
    let cancelled = false;
    setFontLoadError(false);
    getSysFontsList()
      .then((result) => {
        if (cancelled) return;
        if (result.error || !Object.keys(result.fonts).length) {
          setFontLoadError(true);
          return;
        }
        const counts = new Map<string, number>();
        Object.values(result.fonts).forEach((family) =>
          counts.set(family, (counts.get(family) ?? 0) + 1),
        );
        const fonts = Object.entries(result.fonts)
          .filter(
            ([name, family]) =>
              name &&
              !isSymbolicFont(name) &&
              !isRemovedReadingFont(name) &&
              !isRemovedReadingFont(family),
          )
          .map(([name, family]) => (counts.get(family) === 1 ? family : name));
        setSysFonts([...new Set(fonts)].sort((a, b) => a.localeCompare(b)));
      })
      .catch(() => {
        if (!cancelled) setFontLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [appService, fontLoadAttempt]);

  const language = view?.language.canonical || getLocale();
  const isCJK = view?.language.isCJK ?? /^(zh|ja|ko)/i.test(language);
  const sample = getFontPreviewSample(language);
  const latin = getFontPreviewSample('la');
  const activeKey = values.defaultFont === 'Sans-serif' ? 'sansSerifFont' : 'serifFont';
  const families = buildFontFamilyLists(
    values.serifFont,
    values.sansSerifFont,
    values.monospaceFont,
    values.defaultCJKFont,
    language,
    imported,
  );
  const family = activeKey === 'serifFont' ? families.serif : families.sansSerif;
  const cjkLabel = language.startsWith('ja')
    ? _('Japanese Font')
    : language.startsWith('ko')
      ? _('Korean Font')
      : _('Chinese Font');
  const options = (selected: string, fonts: string[]) =>
    [...new Set([selected, ...fonts])]
      .filter((font) => !isRemovedReadingFont(font))
      .map((option) => ({ option, label: _(option) }));
  const allFonts = [
    ...imported,
    ...SERIF_FONTS,
    ...SANS_SERIF_FONTS,
    ...CJK_SERIF_FONTS,
    ...CJK_SANS_SERIF_FONTS,
    ...sysFonts,
  ];
  const cjkFonts = [
    ...imported,
    ...CJK_SERIF_FONTS,
    ...CJK_SANS_SERIF_FONTS,
    ...sysFonts.filter(
      (font) => (CJK_FONTS_PATTENS.test(font) || isCJKStr(font)) && !CJK_EXCLUDE_PATTENS.test(font),
    ),
  ];
  const selectFont = (
    key: 'serifFont' | 'sansSerifFont' | 'monospaceFont' | 'defaultCJKFont',
    font: string,
  ) => change({ [key]: font, overrideFont: true });
  if (fontPanelView === 'custom-fonts')
    return <CustomFonts bookKey={bookKey} onBack={() => setFontPanelView('main-fonts')} />;

  return (
    <div className='glossa-font-panel'>
      <div data-setting-id='settings.font.overrideBookFont'>
        <BoxedList innerClassName='!ps-0' cardClassName='glossa-font-card'>
          {isCJK && (
            <FontPicker
              label={cjkLabel}
              selected={values.defaultCJKFont}
              useBookFonts={!values.overrideFont}
              onSelectBookFonts={() => change({ overrideFont: false })}
              language={language}
              options={options(values.defaultCJKFont, ['Auto', ...cjkFonts])}
              onGetFontFamily={(font) => {
                const fonts = buildFontFamilyLists(
                  'Auto',
                  'Auto',
                  values.monospaceFont,
                  font,
                  language,
                  imported,
                );
                return activeKey === 'serifFont' ? fonts.serif : fonts.sansSerif;
              }}
              onSelect={(font) => selectFont('defaultCJKFont', font)}
              data-setting-id='settings.font.cjkFont'
            />
          )}
          <FontPicker
            label={isCJK ? _('Western Font') : _('Reading Font')}
            selected={values[activeKey]}
            useBookFonts={!values.overrideFont}
            onSelectBookFonts={() => change({ overrideFont: false })}
            language={isCJK ? 'la' : language}
            options={options(values[activeKey], allFonts)}
            onGetFontFamily={(font) =>
              getReadingFontFamily(font, activeKey === 'serifFont' ? 'serif' : 'sans-serif')
            }
            onSelect={(font) => selectFont(activeKey, font)}
            data-setting-id='settings.font.readingFont'
          />
        </BoxedList>
      </div>
      {values.overrideFont && (
        <div
          className='glossa-font-preview eink-bordered'
          role='region'
          aria-label={_('Font Preview')}
        >
          <p
            lang={sample.lang}
            dir={sample.dir}
            style={{
              fontFamily: family,
              fontSize: `${values.defaultFontSize}px`,
              fontWeight: values.fontWeight,
            }}
          >
            {sample.text}
          </p>
          {sample.text !== latin.text && (
            <p
              lang={latin.lang}
              dir='ltr'
              className='glossa-font-preview-latin'
              style={{
                fontFamily: getReadingFontFamily(
                  values[activeKey],
                  activeKey === 'serifFont' ? 'serif' : 'sans-serif',
                ),
                fontSize: `${values.defaultFontSize}px`,
                fontWeight: values.fontWeight,
              }}
            >
              {latin.text}
            </p>
          )}
        </div>
      )}
      <BoxedList innerClassName='!ps-0' cardClassName='glossa-font-card'>
        <FontNumber
          label={_('Font Size')}
          value={values.defaultFontSize}
          min={8}
          max={120}
          onChange={(value) => change({ defaultFontSize: value })}
          settingId='settings.font.defaultFontSize'
        />
        <div data-setting-id='settings.font.fontWeight'>
          <FontNumber
            label={_('Font Weight')}
            value={values.fontWeight}
            min={100}
            max={1000}
            onChange={(value) => change({ fontWeight: value })}
          />
          <div className='px-4 pb-3'>
            <input
              type='range'
              className='glossa-font-weight-slider'
              aria-label={_('Font Weight')}
              min={100}
              max={1000}
              step={1}
              value={values.fontWeight}
              onChange={(event) => change({ fontWeight: Number(event.target.value) })}
            />
          </div>
        </div>
      </BoxedList>

      {fontLoadError && (
        <div className='glossa-font-status' role='status'>
          <span>{_('System fonts unavailable')}</span>
          <button
            type='button'
            className='glossa-button'
            onClick={() => setFontLoadAttempt((value) => value + 1)}
          >
            {_('Retry')}
          </button>
        </div>
      )}
      <div className='glossa-font-actions'>
        <button
          type='button'
          className='glossa-button'
          aria-expanded={more}
          aria-controls={advancedId}
          onClick={() => setMore(!more)}
        >
          {_('More')}
          <ChevronDown size={15} className={more ? 'rotate-180' : ''} />
        </button>
        <button
          type='button'
          className='glossa-button'
          onClick={() => setFontPanelView('custom-fonts')}
          data-setting-id='settings.font.fonts'
        >
          {_('Manage Fonts')}
        </button>
      </div>
      {more && (
        <div id={advancedId} className='glossa-font-advanced'>
          <BoxedList innerClassName='!ps-0' cardClassName='glossa-font-card'>
            <FontPicker
              label={_('Monospace Font')}
              selected={values.monospaceFont}
              language='la'
              options={options(values.monospaceFont, [
                ...imported,
                ...MONOSPACE_FONTS,
                ...sysFonts,
              ])}
              onGetFontFamily={(font) => getReadingFontFamily(font, 'monospace')}
              onSelect={(font) => selectFont('monospaceFont', font)}
              data-setting-id='settings.font.monospaceFont'
            />
          </BoxedList>
        </div>
      )}
      <div className='glossa-font-footer'>
        {bookKey ? (
          <div
            role='group'
            aria-label={_('Apply to')}
            className='glossa-font-segments eink-bordered'
          >
            {[
              { global: false, label: _('This Book') },
              { global: true, label: _('All Books') },
            ].map((item) => (
              <button
                key={item.label}
                type='button'
                className='glossa-button'
                aria-pressed={scope === item.global}
                onClick={() => void saveScope(item.global)}
              >
                {item.label}
              </button>
            ))}
          </div>
        ) : (
          <span>{_('All Books')}</span>
        )}
        <button type='button' className='glossa-button' onClick={handleReset}>
          <RotateCcw size={14} />
          {_('Reset')}
        </button>
      </div>
      {(failed || failedScope !== null) && (
        <div className='glossa-font-status' role='alert'>
          <span>{_('Could not save font settings')}</span>
          <button
            type='button'
            className='glossa-button'
            onClick={() => {
              if (failedScope !== null) void saveScope(failedScope, true);
              if (failed)
                void persist(
                  Object.fromEntries(
                    Object.keys(failed).map((key) => [
                      key,
                      valuesRef.current[key as keyof FontValues],
                    ]),
                  ),
                  true,
                );
            }}
          >
            {_('Retry')}
          </button>
        </div>
      )}
    </div>
  );
};
export default FontPanel;
