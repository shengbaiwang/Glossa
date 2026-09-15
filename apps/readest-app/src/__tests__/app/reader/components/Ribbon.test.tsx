import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import Ribbon from '@/app/reader/components/Ribbon';

vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({ safeAreaInsets: { top: 48, right: 0, bottom: 0, left: 0 } }),
}));

describe('Ribbon', () => {
  it('stacks above the scrolled-mode notch mask so the full ribbon stays visible', () => {
    // In scrolled mode SectionInfo paints a `bg-base-100` `notch-area` mask over the
    // top safe-area strip at z-10. The ribbon renders earlier in the DOM, so it must
    // sit on a higher layer than z-10 or its upper (unsafe-area) half gets covered.
    const { container } = render(<Ribbon />);
    const ribbon = container.querySelector('.ribbon') as HTMLElement;

    expect(ribbon).not.toBeNull();
    expect(ribbon.classList.contains('z-10')).toBe(false);
    expect(ribbon.classList.contains('z-20')).toBe(true);
    // Decorative only: taps must fall through to the notch mask's scroll-to-top.
    expect(ribbon.classList.contains('pointer-events-none')).toBe(true);
  });

  it('hangs inside the top-right corner without blocking page input (#1359)', () => {
    const { container } = render(<Ribbon />);
    const ribbon = container.querySelector('.ribbon') as HTMLElement;

    expect(ribbon.classList.contains('glossa-reader-ribbon')).toBe(true);
    expect(ribbon.classList.contains('top-0')).toBe(true);
    // `inset-0` anchored it to the left edge; the ribbon lives on the right now.
    expect(ribbon.classList.contains('inset-0')).toBe(false);
  });

  it('extends through the safe area while keeping a shallow notch', () => {
    const { container } = render(<Ribbon />);
    const ribbon = container.querySelector('.ribbon') as HTMLElement;

    expect(ribbon.style.height).toBe('82px'); // 48px safe-area top + 34px ribbon
    const points = container.querySelector('polygon')!.getAttribute('points')!;
    const [, notchY] = points.split(' ')[1]!.split(',').map(Number);
    expect(82 - notchY!).toBe(6);
  });
});
