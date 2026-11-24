import { describe, expect, it } from 'vitest';
import { getFooterBarPosition } from '@/app/reader/components/footerbar/position';

describe('getFooterBarPosition', () => {
  it('anchors the mobile footer to the viewport and the desktop footer to its cell', () => {
    expect(getFooterBarPosition(true)).toBe('fixed');
    expect(getFooterBarPosition(false)).toBe('absolute');
  });
});
