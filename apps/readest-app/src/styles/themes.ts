import tinycolor from 'tinycolor2';

export type BaseColor = {
  bg: string;
  fg: string;
  primary: string;
};

/** `ambient` follows the ambient light sensor (lux → light/dark), Android-first. */
export type ThemeMode = 'auto' | 'light' | 'dark' | 'ambient';

export type Palette = {
  'base-100': string;
  'base-200': string;
  'base-300': string;
  'base-content': string;
  neutral: string;
  'neutral-content': string;
  primary: string;
  secondary: string;
  accent: string;
};

export type Theme = {
  name: string;
  label: string;
  colors: {
    light: Palette;
    dark: Palette;
  };
  isCustomizable?: boolean;
};

export type CustomTheme = {
  name: string;
  label: string;
  colors: {
    light: BaseColor;
    dark: BaseColor;
  };
};

function srgbToLinear(v: number): number {
  // Standard formula for gamma decoding of sRGB
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

export function hexToOklch(hexColor: string): string {
  // 1) Convert from hex → sRGB (0..255) → [0..1]
  const { r, g, b } = tinycolor(hexColor).toRgb();
  const R = srgbToLinear(r / 255);
  const G = srgbToLinear(g / 255);
  const B = srgbToLinear(b / 255);

  // 2) Convert linear sRGB → L'M'S'  (the Oklab-specific "LMS" space)
  const l_ = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m_ = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s_ = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);

  // 3) Convert L'M'S' → Oklab
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const b_ = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;

  // 4) Convert Oklab → Oklch
  const C = Math.sqrt(a * a + b_ * b_);
  let h = Math.atan2(b_, a) * (180 / Math.PI);
  if (h < 0) h += 360;

  // 5) Format as l% c h, with a bit of rounding
  const lPercent = (L * 100).toFixed(4);
  const cValue = Number(C.toFixed(6));
  const hValue = Number(h.toFixed(3));

  if (cValue === 0) {
    return `${lPercent}% 0 0deg`;
  }

  return `${lPercent}% ${cValue} ${hValue}deg`;
}

export const getContrastOklch = (hexColor: string): string => {
  return tinycolor(hexColor).isDark() ? '100% 0 0deg' : '0% 0 0deg';
};

export const getContrastHex = (hexColor: string): string => {
  return tinycolor(hexColor).isDark() ? '#FFFFFF' : '#000000';
};

export const generateLightPalette = ({ bg, fg, primary }: BaseColor) => {
  return {
    'base-100': bg, // Main background
    'base-200': tinycolor(bg).darken(5).toHexString(), // Slightly darker
    'base-300': tinycolor(bg).darken(12).toHexString(), // More darker
    'base-content': fg, // Main text color
    neutral: tinycolor(bg).darken(15).desaturate(20).toHexString(), // Muted neutral
    'neutral-content': tinycolor(fg).lighten(20).desaturate(20).toHexString(), // Slightly lighter text
    primary: primary,
    secondary: tinycolor(primary).lighten(20).toHexString(), // Lighter secondary
    accent: tinycolor(primary).analogous()[1]!.toHexString(), // Analogous accent
  } as Palette;
};

export const generateDarkPalette = ({ bg, fg, primary }: BaseColor) => {
  return {
    'base-100': bg, // Main background
    'base-200': tinycolor(bg).lighten(5).toHexString(), // Slightly lighter
    'base-300': tinycolor(bg).lighten(12).toHexString(), // More lighter
    'base-content': fg, // Main text color
    neutral: tinycolor(bg).lighten(15).desaturate(20).toHexString(), // Muted neutral
    'neutral-content': tinycolor(fg).darken(20).desaturate(20).toHexString(), // Darkened text
    primary: primary,
    secondary: tinycolor(primary).darken(20).toHexString(), // Darker secondary
    accent: tinycolor(primary).triad()[1]!.toHexString(), // Triad accent
  } as Palette;
};

const _ = (stubKey: string) => stubKey;

// Built-in palettes use hand-tuned paper/ink surfaces and quiet accents.
// Keep custom palette generation above unchanged for saved user themes.
export const themes = [
  {
    name: 'default',
    label: _('Default'),
    colors: {
      // Paper and ink from Glossa's monochrome mark. Explicit surface steps
      // keep the library, reading canvas and menus close in tone.
      light: {
        'base-100': '#faf9f6',
        'base-200': '#f0efeb',
        'base-300': '#e3e2dd',
        'base-content': '#242521',
        neutral: '#d8d7d1',
        'neutral-content': '#5b5c56',
        primary: '#343630',
        secondary: '#70726b',
        accent: '#50534b',
      },
      dark: {
        'base-100': '#20211f',
        'base-200': '#282926',
        'base-300': '#383a35',
        'base-content': '#edeee8',
        neutral: '#454740',
        'neutral-content': '#b6b9ae',
        primary: '#e1e3d9',
        secondary: '#b6baac',
        accent: '#c5c9bc',
      },
    },
  },
  {
    name: 'darkreader',
    label: _('Soft gray'),
    colors: {
      // Dark Reader's softened gray canvas, with Glossa's restrained surface steps.
      light: {
        'base-100': '#dcdad7',
        'base-200': '#d4d2cf',
        'base-300': '#cac9c6',
        'base-content': '#181a1b',
        neutral: '#c1bfbd',
        'neutral-content': '#303132',
        primary: '#3f494b',
        secondary: '#363e3f',
        accent: '#3f484a',
      },
      dark: {
        'base-100': '#181a1b',
        'base-200': '#202223',
        'base-300': '#2b2c2d',
        'base-content': '#e8e6e3',
        neutral: '#353737',
        'neutral-content': '#cfcecb',
        primary: '#b9c6c9',
        secondary: '#c9d1d2',
        accent: '#c1cbcd',
      },
    },
  },
  {
    name: 'gray',
    label: _('Gray'),
    colors: {
      light: {
        'base-100': '#e9e9e6',
        'base-200': '#e1e2df',
        'base-300': '#d8d8d6',
        'base-content': '#2d302f',
        neutral: '#cfcfcc',
        'neutral-content': '#444645',
        primary: '#454b49',
        secondary: '#414745',
        accent: '#474d4c',
      },
      dark: {
        'base-100': '#292b2b',
        'base-200': '#303232',
        'base-300': '#393b3b',
        'base-content': '#d9ddda',
        neutral: '#424444',
        'neutral-content': '#c4c8c5',
        primary: '#bbc7c1',
        secondary: '#c6cfca',
        accent: '#c0cbc5',
      },
    },
  },
  {
    name: 'sepia',
    label: _('Sepia'),
    colors: {
      light: {
        'base-100': '#f3ecdc',
        'base-200': '#ece5d5',
        'base-300': '#e3dccd',
        'base-content': '#463e32',
        neutral: '#dbd4c4',
        'neutral-content': '#5b5346',
        primary: '#5d5039',
        secondary: '#5b4f3a',
        accent: '#62543d',
      },
      dark: {
        'base-100': '#28241e',
        'base-200': '#302b25',
        'base-300': '#39352d',
        'base-content': '#e7dcc7',
        neutral: '#433e36',
        'neutral-content': '#d0c6b3',
        primary: '#c7b38d',
        secondary: '#d2c1a1',
        accent: '#ccba96',
      },
    },
  },
  {
    name: 'grass',
    label: _('Grass'),
    colors: {
      light: {
        'base-100': '#e7ebe1',
        'base-200': '#e0e4da',
        'base-300': '#d7dcd2',
        'base-content': '#344136',
        neutral: '#ced3c9',
        'neutral-content': '#49554b',
        primary: '#4b5f48',
        secondary: '#485a46',
        accent: '#4d624b',
      },
      dark: {
        'base-100': '#222821',
        'base-200': '#293028',
        'base-300': '#333931',
        'base-content': '#dce4d5',
        neutral: '#3c423a',
        'neutral-content': '#c6cdbf',
        primary: '#aabea0',
        secondary: '#bccbb3',
        accent: '#b2c4a8',
      },
    },
  },
  {
    name: 'cherry',
    label: _('Cherry'),
    colors: {
      light: {
        'base-100': '#f1e7e6',
        'base-200': '#eae0df',
        'base-300': '#e2d7d6',
        'base-content': '#4b3839',
        neutral: '#dacfce',
        'neutral-content': '#5f4d4e',
        primary: '#705559',
        secondary: '#694f52',
        accent: '#72565a',
      },
      dark: {
        'base-100': '#2b2325',
        'base-200': '#332a2c',
        'base-300': '#3c3335',
        'base-content': '#e8d9da',
        neutral: '#453c3e',
        'neutral-content': '#d1c3c4',
        primary: '#c7a7af',
        secondary: '#d3b9be',
        accent: '#ccafb6',
      },
    },
  },
  {
    name: 'sky',
    label: _('Sky'),
    colors: {
      light: {
        'base-100': '#e6ebef',
        'base-200': '#dfe4e8',
        'base-300': '#d6dce0',
        'base-content': '#34424b',
        neutral: '#cdd3d8',
        'neutral-content': '#49565f',
        primary: '#49606f',
        secondary: '#465b68',
        accent: '#4b6271',
      },
      dark: {
        'base-100': '#21282d',
        'base-200': '#282f34',
        'base-300': '#32393e',
        'base-content': '#d9e2e8',
        neutral: '#3b4247',
        'neutral-content': '#c3ccd2',
        primary: '#a6bbc9',
        secondary: '#b8c9d4',
        accent: '#aec1ce',
      },
    },
  },
  {
    name: 'solarized',
    label: _('Solarized'),
    colors: {
      light: {
        'base-100': '#f5efdc',
        'base-200': '#ede8d6',
        'base-300': '#e4e0cf',
        'base-content': '#35494f',
        neutral: '#dad8c8',
        'neutral-content': '#4c5d60',
        primary: '#315e70',
        secondary: '#365d6c',
        accent: '#366274',
      },
      dark: {
        'base-100': '#142b31',
        'base-200': '#1c3238',
        'base-300': '#253b40',
        'base-content': '#d3dfdc',
        neutral: '#2f4449',
        'neutral-content': '#bcc9c7',
        primary: '#92babc',
        secondary: '#a9c7c7',
        accent: '#9cc0c1',
      },
    },
  },
  {
    name: 'gruvbox',
    label: _('Gruvbox'),
    colors: {
      light: {
        'base-100': '#f3ead5',
        'base-200': '#ece3cf',
        'base-300': '#e3dac6',
        'base-content': '#453c33',
        neutral: '#dbd2be',
        'neutral-content': '#5a5146',
        primary: '#5f553e',
        secondary: '#5c513e',
        accent: '#625841',
      },
      dark: {
        'base-100': '#2b2823',
        'base-200': '#322f29',
        'base-300': '#3c3831',
        'base-content': '#e5d9bf',
        neutral: '#454139',
        'neutral-content': '#cfc4ac',
        primary: '#c5b38b',
        secondary: '#d0c09d',
        accent: '#cab993',
      },
    },
  },
  {
    name: 'nord',
    label: _('Nord'),
    colors: {
      light: {
        'base-100': '#e9edf2',
        'base-200': '#e2e6eb',
        'base-300': '#d9dde3',
        'base-content': '#343e4c',
        neutral: '#d0d5db',
        'neutral-content': '#4a5360',
        primary: '#485f79',
        secondary: '#455870',
        accent: '#4a607a',
      },
      dark: {
        'base-100': '#272f3b',
        'base-200': '#2e3642',
        'base-300': '#373f4b',
        'base-content': '#dee5ee',
        neutral: '#414854',
        'neutral-content': '#c8cfd9',
        primary: '#a4bdce',
        secondary: '#b8cbd9',
        accent: '#adc3d3',
      },
    },
  },
  {
    name: 'contrast',
    label: _('Contrast'),
    colors: {
      light: {
        'base-100': '#ffffff',
        'base-200': '#f5f5f5',
        'base-300': '#e8e8e8',
        'base-content': '#000000',
        neutral: '#dbdbdb',
        'neutral-content': '#1f1f1f',
        primary: '#2c2e29',
        secondary: '#22231f',
        accent: '#2c2d28',
      },
      dark: {
        'base-100': '#000000',
        'base-200': '#0a0a0a',
        'base-300': '#171717',
        'base-content': '#ffffff',
        neutral: '#242424',
        'neutral-content': '#e0e0e0',
        primary: '#e8e6e3',
        secondary: '#f0efed',
        accent: '#eceae7',
      },
    },
  },
  {
    name: 'sunset',
    label: _('Sunset'),
    colors: {
      light: {
        'base-100': '#f4e8dd',
        'base-200': '#ede1d6',
        'base-300': '#e5d9ce',
        'base-content': '#4d3c33',
        neutral: '#ddd0c5',
        'neutral-content': '#615147',
        primary: '#785441',
        secondary: '#6f503f',
        accent: '#7a5643',
      },
      dark: {
        'base-100': '#2d2520',
        'base-200': '#352c27',
        'base-300': '#3e3530',
        'base-content': '#ecdbcd',
        neutral: '#483e38',
        'neutral-content': '#d5c5b8',
        primary: '#d3ae94',
        secondary: '#dcbea8',
        accent: '#d7b59d',
      },
    },
  },
] as Theme[];

const generateCustomThemeVariables = (palette: Palette, fallbackIncluded = false): string => {
  const colors = `
    --b1: ${hexToOklch(palette['base-100'])};
    --b2: ${hexToOklch(palette['base-200'])};
    --b3: ${hexToOklch(palette['base-300'])};
    --bc: ${hexToOklch(palette['base-content'])};
    
    --p: ${hexToOklch(palette.primary)};
    --pc: ${getContrastOklch(palette.primary)};
    
    --s: ${hexToOklch(palette.secondary)};
    --sc: ${getContrastOklch(palette.secondary)};
    
    --a: ${hexToOklch(palette.accent)};
    --ac: ${getContrastOklch(palette.accent)};
    
    --n: ${hexToOklch(palette.neutral)};
    --nc: ${hexToOklch(palette['neutral-content'])};
    
    --in: 69.37% 0.047 231deg;
    --inc: 100% 0 0deg;
    --su: 78.15% 0.12 160deg;
    --suc: 100% 0 0deg;
    --wa: 90.69% 0.123 84deg;
    --wac: 0% 0 0deg;
    --er: 70.9% 0.184 22deg;
    --erc: 100% 0 0deg;
  `;

  const fallbackColors = `
    --fallback-b1: ${palette['base-100']};
    --fallback-b2: ${palette['base-200']};
    --fallback-b3: ${palette['base-300']};
    --fallback-bc: ${palette['base-content']};

    --fallback-p: ${palette.primary};
    --fallback-pc: ${getContrastHex(palette.primary)};

    --fallback-s: ${palette.secondary};
    --fallback-sc: ${getContrastHex(palette.secondary)};

    --fallback-a: ${palette.accent};
    --fallback-ac: ${getContrastHex(palette.accent)};

    --fallback-n: ${palette.neutral};
    --fallback-nc: ${palette['neutral-content']};

    --fallback-in: #ff0000;
    --fallback-inc: #ffffff;
    --fallback-su: #00ff00;
    --fallback-suc: #000000;
    --fallback-wa: #ffff00;
    --fallback-wac: #000000;
    --fallback-er: #ff8000;
    --fallback-erc: #000000;
  `;

  return colors + (fallbackIncluded ? fallbackColors : '');
};

export const applyCustomTheme = (
  customTheme?: CustomTheme,
  themeName?: string,
  fallbackIncluded = false,
) => {
  if (!customTheme && !themeName) return;

  const lightThemeName = customTheme ? `${customTheme.name}-light` : `${themeName}-light`;
  const darkThemeName = customTheme ? `${customTheme.name}-dark` : `${themeName}-dark`;

  const lightPalette = customTheme
    ? generateLightPalette(customTheme.colors.light)
    : (themes.find((t) => t.name === themeName) || themes[0]!).colors.light;

  const darkPalette = customTheme
    ? generateDarkPalette(customTheme.colors.dark)
    : (themes.find((t) => t.name === themeName) || themes[0]!).colors.dark;

  const css = `
    [data-theme="${lightThemeName}"] {
      ${generateCustomThemeVariables(lightPalette, fallbackIncluded)}
    }
    
    [data-theme="${darkThemeName}"] {
      ${generateCustomThemeVariables(darkPalette, fallbackIncluded)}
    }
    
    :root {
      --${lightThemeName}: 1;
      --${darkThemeName}: 1;
    }
  `;

  const styleElement = document.createElement('style');
  styleElement.id = `theme-${customTheme ? customTheme.name : themeName}-styles`;
  styleElement.textContent = css;

  const existingStyle = document.getElementById(styleElement.id);
  if (existingStyle) {
    existingStyle.remove();
  }

  document.head.appendChild(styleElement);

  return {
    light: lightThemeName,
    dark: darkThemeName,
  };
};
