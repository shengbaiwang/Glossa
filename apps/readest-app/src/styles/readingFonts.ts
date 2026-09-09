/** Local aliases keep the same reading style across macOS, Windows and Linux/Android. */
const FONT_ALIASES: Record<string, string[]> = {
  'Times New Roman': ['Times New Roman', 'Times', 'Liberation Serif', 'Noto Serif'],
  Georgia: ['Georgia', 'Charter', 'Noto Serif'],
  Arial: ['Arial', 'Helvetica', 'Liberation Sans', 'Noto Sans'],
  Helvetica: ['Helvetica', 'Arial', 'Liberation Sans', 'Noto Sans'],
  Verdana: ['Verdana', 'DejaVu Sans', 'Noto Sans'],
  Tahoma: ['Tahoma', 'Geeza Pro', 'Noto Sans Arabic', 'Noto Sans'],
  'Courier New': ['Courier New', 'Courier', 'Liberation Mono', 'Noto Sans Mono'],
  Consolas: ['Consolas', 'Menlo', 'DejaVu Sans Mono'],
  Menlo: ['Menlo', 'Consolas', 'DejaVu Sans Mono'],
  SimSun: ['SimSun', 'Songti SC', 'STSong', 'Noto Serif CJK SC', 'Noto Serif SC'],
  KaiTi: [
    'KaiTi',
    'Kaiti SC',
    'STKaiti',
    'Kai',
    'AR PL UKai CN',
    'Glossa Kai',
    'Noto Serif CJK SC',
  ],
  FangSong: ['FangSong', 'STFangsong', 'FangSong SC', 'Noto Serif CJK SC'],
  MingLiU: ['MingLiU', 'PMingLiU', 'Songti TC', 'Noto Serif CJK TC', 'Noto Serif TC'],
  'Microsoft JhengHei': ['Microsoft JhengHei', 'PingFang TC', 'Noto Sans CJK TC', 'Noto Sans TC'],
  SimHei: ['SimHei', 'Heiti SC', 'PingFang SC', 'Noto Sans CJK SC', 'Noto Sans SC'],
  'Microsoft YaHei': ['Microsoft YaHei', 'PingFang SC', 'Noto Sans CJK SC', 'Noto Sans SC'],
  'Yu Mincho': [
    'Yu Mincho',
    'Hiragino Mincho ProN',
    'Hiragino Mincho Pro',
    'MS Mincho',
    'Noto Serif CJK JP',
    'Noto Serif JP',
  ],
  'Yu Gothic': [
    'Yu Gothic',
    'Hiragino Sans',
    'Hiragino Kaku Gothic ProN',
    'Meiryo',
    'Noto Sans CJK JP',
    'Noto Sans JP',
  ],
  Batang: ['Batang', 'AppleMyungjo', 'Nanum Myeongjo', 'Noto Serif CJK KR', 'Noto Serif KR'],
  'Malgun Gothic': [
    'Malgun Gothic',
    'Apple SD Gothic Neo',
    'Dotum',
    'Noto Sans CJK KR',
    'Noto Sans KR',
  ],
  'Traditional Arabic': ['Traditional Arabic', 'Geeza Pro', 'Noto Naskh Arabic', 'Amiri'],
};

// Migrate removed catalog selections to common presets.
const LEGACY_FONTS: Record<string, string> = {
  Bitter: 'Times New Roman',
  Literata: 'Times New Roman',
  Merriweather: 'Georgia',
  'Roboto Slab': 'Times New Roman',
  Vollkorn: 'Times New Roman',
  'PT Serif': 'Times New Roman',
  Roboto: 'Arial',
  'Noto Sans': 'Arial',
  'Open Sans': 'Arial',
  'PT Sans': 'Arial',
  'Fira Code': 'Courier New',
  'PT Mono': 'Courier New',
  'LXGW WenKai GB Screen': 'Auto',
  'LXGW WenKai TC': 'Auto',
  'GuanKiapTsingKhai-T': 'Auto',
  'Source Han Serif CN': 'Auto',
  'Huiwen-MinchoGBK': 'Auto',
  KingHwa_OldSong: 'Auto',
  'Noto Sans SC': 'Microsoft YaHei',
  'Noto Sans TC': 'Microsoft JhengHei',
};

// These families were explicitly removed from Glossa's font library.
// Ignore spacing/dash variations in localized display names and font metadata.
export const isRemovedReadingFont = (font: string) => {
  const name = font
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s_\-‐‑‒–—]/g, '');
  return ['100ssxiansongti', '173ssshanshuisongti', '波本威士忌', '寒蝉锦书宋', '三极花朝体'].some(
    (removed) => name.startsWith(removed),
  );
};

export const resolveReadingFont = (
  font: string,
  fallback = 'Times New Roman',
  customFamilies: string[] = [],
) => {
  if (!font || isRemovedReadingFont(font)) return fallback;
  if (customFamilies.includes(font)) return font;
  return LEGACY_FONTS[font] ?? font;
};

const expandFont = (font: string) => FONT_ALIASES[font] ?? [font];
const fontList = (fonts: string[], generic: string) =>
  [...[...new Set(fonts.flatMap(expandFont))].map((font) => JSON.stringify(font)), generic].join(
    ', ',
  );

export const getReadingFontFamily = (font: string, generic: string) =>
  fontList(font === 'Auto' ? [] : [font], generic);

export const READING_FONT_LANGUAGES = [
  'zh-CN',
  'zh-TW',
  'zh-HK',
  'zh-MO',
  'zh-Hant',
  'ja',
  'ko',
  'ar',
];

export const buildFontFamilyLists = (
  serif: string,
  sansSerif: string,
  monospace: string,
  cjk: string,
  language = 'zh-CN',
  customFamilies: string[] = [],
) => {
  serif = resolveReadingFont(serif, 'Times New Roman', customFamilies);
  sansSerif = resolveReadingFont(sansSerif, 'Arial', customFamilies);
  monospace = resolveReadingFont(monospace, 'Courier New', customFamilies);
  cjk = resolveReadingFont(cjk, 'Auto', customFamilies);
  const lang = language.toLowerCase();
  const traditional = /^zh-(tw|hk|mo|hant)/.test(lang);
  const regionalSerif = lang.startsWith('ja')
    ? 'Yu Mincho'
    : lang.startsWith('ko')
      ? 'Batang'
      : traditional
        ? 'MingLiU'
        : 'SimSun';
  const regionalSans = lang.startsWith('ja')
    ? 'Yu Gothic'
    : lang.startsWith('ko')
      ? 'Malgun Gothic'
      : traditional
        ? 'Microsoft JhengHei'
        : 'Microsoft YaHei';
  const cjkSerif = cjk === 'Auto' ? regionalSerif : cjk;
  const cjkSans = cjk === 'Auto' ? regionalSans : cjk;
  const arabicSerif =
    lang.startsWith('ar') && serif === 'Times New Roman' && !customFamilies.includes(serif);
  const arabicSans =
    lang.startsWith('ar') && sansSerif === 'Arial' && !customFamilies.includes(sansSerif);
  // Resolve installed aliases and the bundled Kai fallback without external font requests.
  return {
    serif: fontList(
      [
        ...(arabicSerif ? ['Traditional Arabic'] : []),
        ...(serif === 'Auto' ? [] : [serif]),
        cjkSerif,
        'Times New Roman',
        'Traditional Arabic',
      ],
      'serif',
    ),
    sansSerif: fontList(
      [
        ...(arabicSans ? ['Tahoma'] : []),
        ...(sansSerif === 'Auto' ? [] : [sansSerif]),
        cjkSans,
        'Arial',
        'Tahoma',
      ],
      'sans-serif',
    ),
    monospace: fontList([monospace, 'Courier New'], 'monospace'),
  };
};

/** The local Kai fallback loads only when a selected/previewed face uses it. */
export const getBundledReadingFontCSS = () => {
  const url =
    typeof window === 'undefined'
      ? '/fonts/ar-pl-ukai-cn.woff2'
      : new URL('/fonts/ar-pl-ukai-cn.woff2', window.location.href).href;
  return `@font-face {
    font-family: "Glossa Kai";
    src: url("${url}") format("woff2");
    font-style: normal;
    font-weight: 400;
    font-display: swap;
  }`;
};
