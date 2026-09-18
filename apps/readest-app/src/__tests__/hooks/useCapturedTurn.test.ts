import { describe, it, expect, afterEach, vi } from 'vitest';

// The real themeStore module body reads localStorage at creation time, which
// is absent in this jsdom environment; turn-style logic never touches themes.
vi.mock('@/store/themeStore', () => ({
  useThemeStore: Object.assign(
    () => ({ themeCode: { bg: '#ffffff' }, isDarkMode: false }),
    {
      getState: () => ({ themeCode: { bg: '#ffffff' }, isDarkMode: false }),
      subscribe: () => () => {},
    },
  ),
}));

import { applyPageTurnAttributes, getCapturedTurnStyle } from '@/app/reader/hooks/useCapturedTurn';
import type { FoliateView } from '@/types/view';
import type { ViewSettings } from '@/types/book';

// The DOM lib types startViewTransition as always present; go through a
// loose shape so the stub can also remove it.
type VTDocument = { startViewTransition?: () => void };

// iOS 18 WebKit has startViewTransition but crashes the WebContent process on
// the layered turns (#555); engines with nested view-transition groups
// (Chrome/WebView 140+) are the ones known to run them reliably.
const stubEngine = ({
  startViewTransition,
  nestedGroups,
}: {
  startViewTransition: boolean;
  nestedGroups: boolean;
}) => {
  const doc = document as unknown as VTDocument;
  if (startViewTransition) doc.startViewTransition = () => {};
  else delete doc.startViewTransition;
  vi.stubGlobal('CSS', {
    supports: (property: string, value: string) =>
      nestedGroups && property === 'view-transition-group' && value === 'nearest',
  });
};

const makeView = () => {
  const renderer = document.createElement('foliate-paginator');
  return { view: { renderer } as unknown as FoliateView, renderer };
};

const settings = (pageTurnStyle: ViewSettings['pageTurnStyle']) =>
  ({
    pageTurnStyle,
    animated: true,
    scrolled: false,
    disableSwipe: false,
    isEink: false,
  }) as ViewSettings;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  delete (document as unknown as VTDocument).startViewTransition;
});

describe('getCapturedTurnStyle', () => {
  it('maps retired slide settings to the paper capture path', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_PLATFORM', 'tauri');
    stubEngine({ startViewTransition: true, nestedGroups: false });
    expect(getCapturedTurnStyle(settings('slide'), false, false)).toBe('slide');
  });

  it('leaves retired slide settings to paper View Transitions on fully supporting engines', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_PLATFORM', 'tauri');
    stubEngine({ startViewTransition: true, nestedGroups: true });
    expect(getCapturedTurnStyle(settings('slide'), false, false)).toBeNull();
  });

  it('keeps retired slide settings on the pre-warmed capture path on mobile Tauri engines', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_PLATFORM', 'tauri');
    stubEngine({ startViewTransition: true, nestedGroups: true });
    expect(getCapturedTurnStyle(settings('slide'), false, true)).toBe('slide');
  });

  it('never captures outside Tauri platforms', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_PLATFORM', 'web');
    stubEngine({ startViewTransition: true, nestedGroups: false });
    expect(getCapturedTurnStyle(settings('slide'), false)).toBeNull();
    expect(getCapturedTurnStyle(settings('paper'), false)).toBeNull();
    expect(getCapturedTurnStyle(settings('curl'), false)).toBeNull();
  });

  it('captures paper as a flat slide when the engine cannot layer View Transitions', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_PLATFORM', 'tauri');
    stubEngine({ startViewTransition: true, nestedGroups: false });
    expect(getCapturedTurnStyle(settings('paper'), false, false)).toBe('slide');
  });

  it('leaves paper to View Transitions on fully supporting desktop Tauri engines', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_PLATFORM', 'tauri');
    stubEngine({ startViewTransition: true, nestedGroups: true });
    expect(getCapturedTurnStyle(settings('paper'), false, false)).toBeNull();
  });

  it('keeps paper on the pre-warmed capture path on mobile Tauri engines', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_PLATFORM', 'tauri');
    stubEngine({ startViewTransition: true, nestedGroups: true });
    expect(getCapturedTurnStyle(settings('paper'), false, true)).toBe('slide');
  });
});

describe('applyPageTurnAttributes', () => {
  it('keeps the paper View Transition on fully supporting engines', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_PLATFORM', 'web');
    stubEngine({ startViewTransition: true, nestedGroups: true });
    const { view, renderer } = makeView();
    applyPageTurnAttributes(view, settings('paper'), false, false);
    expect(renderer.getAttribute('turn-style')).toBe('paper');
  });

  it('passes retired slide settings through; the paginator normalizes them to paper', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_PLATFORM', 'web');
    stubEngine({ startViewTransition: true, nestedGroups: true });
    const { view, renderer } = makeView();
    applyPageTurnAttributes(view, settings('slide'), false, false);
    expect(renderer.getAttribute('turn-style')).toBe('slide');
  });

  it('falls back to push on web engines without full View Transitions support', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_PLATFORM', 'web');
    stubEngine({ startViewTransition: true, nestedGroups: false });
    const { view, renderer } = makeView();
    renderer.setAttribute('turn-style', 'paper');
    renderer.setAttribute('captured-turn-style', 'slide');
    applyPageTurnAttributes(view, settings('paper'), false, false);
    expect(renderer.hasAttribute('turn-style')).toBe(false);
    expect(renderer.hasAttribute('captured-turn-style')).toBe(false);
  });

  it('hands paper to the capture pipeline on Tauri without full support', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_PLATFORM', 'tauri');
    stubEngine({ startViewTransition: true, nestedGroups: false });
    const { view, renderer } = makeView();
    applyPageTurnAttributes(view, settings('paper'), false, false);
    // The app slides the captured page itself: the paginator must not run
    // its own View Transition nor its swipe tracking.
    expect(renderer.hasAttribute('turn-style')).toBe(false);
    expect(renderer.hasAttribute('no-swipe')).toBe(true);
    expect(renderer.getAttribute('captured-turn-style')).toBe('slide');
  });

  it('keeps the paper View Transition on fully supporting desktop Tauri engines', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_PLATFORM', 'tauri');
    stubEngine({ startViewTransition: true, nestedGroups: true });
    const { view, renderer } = makeView();
    applyPageTurnAttributes(view, settings('paper'), false, false);
    expect(renderer.getAttribute('turn-style')).toBe('paper');
    expect(renderer.hasAttribute('no-swipe')).toBe(false);
    expect(renderer.hasAttribute('captured-turn-style')).toBe(false);
  });

  it('hands paper to the capture pipeline on fully supporting mobile Tauri engines', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_PLATFORM', 'tauri');
    stubEngine({ startViewTransition: true, nestedGroups: true });
    const { view, renderer } = makeView();
    applyPageTurnAttributes(view, settings('paper'), false, true);
    expect(renderer.hasAttribute('turn-style')).toBe(false);
    expect(renderer.hasAttribute('no-swipe')).toBe(true);
    expect(renderer.getAttribute('captured-turn-style')).toBe('slide');
  });

  it('does not publish the native touch arena when swipe navigation is disabled', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_PLATFORM', 'tauri');
    stubEngine({ startViewTransition: true, nestedGroups: false });
    const { view, renderer } = makeView();
    const disabled = settings('paper');
    disabled.disableSwipe = true;

    applyPageTurnAttributes(view, disabled, false, false);

    expect(renderer.hasAttribute('no-swipe')).toBe(true);
    expect(renderer.hasAttribute('captured-turn-style')).toBe(false);
  });

  it('keeps the View Transition paper on fully supporting engines', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_PLATFORM', 'web');
    stubEngine({ startViewTransition: true, nestedGroups: true });
    const { view, renderer } = makeView();
    applyPageTurnAttributes(view, settings('paper'), false, false);
    expect(renderer.getAttribute('turn-style')).toBe('paper');
  });

  it('falls paper back to push on web engines without full View Transitions support', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_PLATFORM', 'web');
    stubEngine({ startViewTransition: true, nestedGroups: false });
    const { view, renderer } = makeView();
    applyPageTurnAttributes(view, settings('paper'), false, false);
    expect(renderer.hasAttribute('turn-style')).toBe(false);
    expect(renderer.hasAttribute('captured-turn-style')).toBe(false);
  });

  it('hands paper to the capture pipeline as a slide on Tauri without full support', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_PLATFORM', 'tauri');
    stubEngine({ startViewTransition: true, nestedGroups: false });
    const { view, renderer } = makeView();
    applyPageTurnAttributes(view, settings('paper'), false, false);
    expect(renderer.hasAttribute('turn-style')).toBe(false);
    expect(renderer.hasAttribute('no-swipe')).toBe(true);
    expect(renderer.getAttribute('captured-turn-style')).toBe('slide');
  });
});
