import { cleanup, render } from '@testing-library/react';
import { useLayoutEffect } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useResponsiveSize', () => ({
  useResponsiveSize: (value: number) => value,
}));
vi.mock('@/hooks/useKeyDownActions', () => ({
  useKeyDownActions: vi.fn(),
}));

import Popup from '@/components/Popup';

describe('Popup capture state', () => {
  beforeAll(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });

  afterEach(cleanup);
  afterAll(() => vi.unstubAllGlobals());

  it('marks only an open popup as capture-blocking', () => {
    const { container, rerender } = render(
      <Popup isOpen={false} width={240}>
        Footnote
      </Popup>,
    );
    const popup = container.querySelector<HTMLElement>('.popup-container')!;

    expect(popup.getAttribute('aria-hidden')).toBe('true');
    expect(popup.hasAttribute('data-capture-blocking-overlay')).toBe(false);

    rerender(
      <Popup isOpen width={240}>
        Footnote
      </Popup>,
    );

    expect(popup.getAttribute('aria-hidden')).toBe('false');
    expect(popup.getAttribute('data-capture-blocking-overlay')).toBe('true');
  });

  it('anchors an explicitly sized popup before painting, including when its height changes', () => {
    const paintedTops: string[] = [];
    const ReadPosition = () => {
      useLayoutEffect(() => {
        paintedTops.push(document.querySelector<HTMLElement>('#popup-container')!.style.top);
      });
      return <span>Footnote</span>;
    };
    const content = (height: number) => (
      <Popup
        width={360}
        height={height}
        position={{ dir: 'up', point: { x: 100, y: 200 } }}
        trianglePosition={{ dir: 'up', point: { x: 200, y: 560 } }}
      >
        <ReadPosition />
      </Popup>
    );
    const { rerender } = render(content(180));
    rerender(content(320));
    expect(paintedTops).toEqual(['380px', '240px']);
  });
});
