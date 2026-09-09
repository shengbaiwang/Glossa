export interface FontPreviewSample {
  text: string;
  lang: string;
  dir: 'ltr' | 'rtl';
}

const LATIN_SAMPLE: FontPreviewSample = {
  text: 'Sunt lacrimae rerum et mentem mortalia tangunt.',
  lang: 'la',
  dir: 'ltr',
};

// Original sample lines for the remaining scripts; these are not attributed quotations.
const SCRIPT_SAMPLES: Record<string, FontPreviewSample> = {
  ja: { text: '小雨が葉を渡り、静かな光が窓に満ちる。', lang: 'ja', dir: 'ltr' },
  ko: { text: '가벼운 비가 잎을 스치고, 고요한 빛이 창가에 머문다.', lang: 'ko', dir: 'ltr' },
  ar: { text: 'يعبر النسيم أوراق الشجر، ويستريح الضوء على النافذة.', lang: 'ar', dir: 'rtl' },
  fa: { text: 'نسیم از میان برگ‌ها می‌گذرد و نور کنار پنجره آرام می‌گیرد.', lang: 'fa', dir: 'rtl' },
  he: { text: 'הרוח עוברת בין העלים, והאור נח על אדן החלון.', lang: 'he', dir: 'rtl' },
  ru: { text: 'Тихий дождь касается листьев, и свет отдыхает у окна.', lang: 'ru', dir: 'ltr' },
  uk: { text: 'Тихий дощ торкається листя, і світло спочиває біля вікна.', lang: 'uk', dir: 'ltr' },
  el: {
    text: 'Η αύρα περνά ανάμεσα στα φύλλα και το φως ησυχάζει στο παράθυρο.',
    lang: 'el',
    dir: 'ltr',
  },
  hi: { text: 'हल्की हवा पत्तों से गुज़रती है, और उजाला खिड़की पर ठहर जाता है।', lang: 'hi', dir: 'ltr' },
  bn: { text: 'মৃদু বাতাস পাতার ফাঁকে বয়ে যায়, আলো থেমে থাকে জানালায়।', lang: 'bn', dir: 'ltr' },
  th: { text: 'ลมอ่อนพัดผ่านใบไม้ แสงละมุนพักอยู่ริมหน้าต่าง', lang: 'th', dir: 'ltr' },
  ta: {
    text: 'தென்றல் இலைகளைத் தழுவுகிறது; ஒளி சாளரத்தில் தங்குகிறது.',
    lang: 'ta',
    dir: 'ltr',
  },
  si: {
    text: 'මඳ සුළඟ කොළ අතරින් හමා යයි; මෘදු එළිය ජනේලය ළඟ රැඳෙයි.',
    lang: 'si',
    dir: 'ltr',
  },
  bo: {
    text: 'རླུང་བསིལ་ལོ་མའི་བར་ནས་ལྡང་། འོད་ཟེར་སྒེའུ་ཁུང་ལ་འཕྲོ།',
    lang: 'bo',
    dir: 'ltr',
  },
};

/** Samples follow the reading language while Western font comparisons share one Latin line. */
export const getFontPreviewSample = (language = ''): FontPreviewSample => {
  const locale = language.trim().toLowerCase().replaceAll('_', '-');
  const [base] = locale.split('-');
  if (base === 'zh') {
    const traditional = !locale.includes('-hans') && /-(hant|tw|hk|mo)(-|$)/.test(locale);
    return {
      text: traditional ? '微雨從東來，好風與之俱' : '微雨从东来，好风与之俱',
      lang: traditional ? 'zh-Hant' : 'zh-Hans',
      dir: 'ltr',
    };
  }
  if (locale.includes('-latn')) return LATIN_SAMPLE;
  return SCRIPT_SAMPLES[base ?? ''] ?? LATIN_SAMPLE;
};
