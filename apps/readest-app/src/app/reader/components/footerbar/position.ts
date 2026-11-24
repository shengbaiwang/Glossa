export type FooterBarPosition = 'fixed' | 'absolute';

export const getFooterBarPosition = (useMobileFooterLayout: boolean): FooterBarPosition =>
  useMobileFooterLayout ? 'fixed' : 'absolute';
