import clsx from 'clsx';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft as MdArrowBack } from '@/components/GlossaIcons';

import { BookDoc } from '@/libs/document';
import { useReaderStore } from '@/store/readerStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useFoliateEvents } from '../hooks/useFoliateEvents';
import { useCustomFontStore } from '@/store/customFontStore';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { useKeyDownActions } from '@/hooks/useKeyDownActions';
import { getFootnoteStyles, getStyles, getThemeCode } from '@/utils/style';
import { getPopupPosition, getPosition, Position } from '@/utils/sel';
import { FootnoteHandler } from 'foliate-js/footnotes.js';
import { mountAdditionalFonts, mountCustomFont } from '@/styles/fonts';
import { eventDispatcher } from '@/utils/event';
import { shouldCheckAsFootnote } from '../utils/footnoteHeuristics';
import { FoliateView } from '@/types/view';
import { Overlay } from '@/components/Overlay';
import Popup from '@/components/Popup';
import '@/styles/footnote.css';

interface FootnotePopupProps {
  bookKey: string;
  bookDoc: BookDoc;
}

const popupWidth = 360;
const popupHeight = 360;

const FootnotePopup: React.FC<FootnotePopupProps> = ({ bookKey, bookDoc }) => {
  const footnoteRef = useRef<HTMLDivElement>(null);
  const footnoteViewRef = useRef<FoliateView | null>(null);
  const trianglePositionRef = useRef<Position | null>(null);
  const [trianglePosition, setTrianglePosition] = useState<Position | null>();
  const [showPopup, setShowPopup] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);

  const { getBookData } = useBookDataStore();
  const { getView, getViewSettings } = useReaderStore();
  const { getLoadedFonts } = useCustomFontStore();
  const view = getView(bookKey);
  const viewSettings = getViewSettings(bookKey)!;
  const containerRef = useRef<HTMLDivElement>(null);
  const footnoteHrefRef = useRef<string | null>(null);
  const historyRef = useRef<{ items: Record<string, unknown>[]; index: number }>({
    items: [],
    index: -1,
  });
  const [canGoBack, setCanGoBack] = useState(false);
  const canGoBackRef = useRef(canGoBack);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollCleanupRef = useRef<(() => void) | null>(null);

  const hideScrollbar = useCallback(() => {
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    scrollTimerRef.current = null;
    containerRef.current?.removeAttribute('data-scrolling');
  }, []);

  const handleScroll = useCallback(() => {
    hideScrollbar();
    containerRef.current?.setAttribute('data-scrolling', 'true');
    scrollTimerRef.current = setTimeout(hideScrollbar, 800);
  }, [hideScrollbar]);

  const gridRectRef = useRef<DOMRect | null>(null);
  const [responsiveWidth, setResponsiveWidth] = useState(popupWidth);
  const [responsiveHeight, setResponsiveHeight] = useState(popupHeight);
  const requestRef = useRef(0);
  const size18 = useResponsiveSize(18);
  const popupPadding = useResponsiveSize(10);

  const popupPosition =
    trianglePosition && gridRectRef.current
      ? getPopupPosition(
          trianglePosition,
          gridRectRef.current,
          responsiveWidth,
          responsiveHeight,
          popupPadding,
        )
      : undefined;

  const preparePopup = () => {
    const rect = gridRectRef.current!;
    const { dir, point } = trianglePositionRef.current!;
    const maxWidth = Math.max(
      32,
      Math.min(
        720,
        rect.width - 2 * popupPadding,
        dir === 'left'
          ? point.x - popupPadding
          : dir === 'right'
            ? rect.width - point.x - popupPadding - 6
            : Infinity,
      ),
    );
    const maxHeight = Math.max(
      32,
      Math.min(
        rect.height * 0.8,
        rect.height - 2 * popupPadding,
        dir === 'up'
          ? point.y - popupPadding
          : dir === 'down'
            ? rect.height - point.y - popupPadding - 6
            : Infinity,
      ),
    );
    const vertical = getViewSettings(bookKey)!.vertical;
    const width = vertical
      ? maxWidth
      : Math.min(maxWidth, Math.max(360, Math.min(560, rect.width * 0.55)));
    const height = vertical ? Math.min(maxHeight, Math.max(360, rect.height * 0.65)) : maxHeight;
    setShowPopup(false);
    setIsPreparing(true);
    setResponsiveWidth(width);
    setResponsiveHeight(height);
    return { width, height, maxWidth, maxHeight, vertical };
  };

  // Measure in the actual popup, with its reading fonts and border. All
  // provisional sizes stay invisible; once revealed, scrolling cannot resize it.
  const fitPopup = async (
    readSize: () => number,
    request: number,
    bounds: ReturnType<typeof preparePopup>,
    ready: () => Promise<unknown>,
    finish?: () => void,
  ) => {
    const measure = async () => {
      let previous = 0;
      let stableFrames = 0;
      for (let frame = 0; frame < 30; frame++) {
        await new Promise(requestAnimationFrame);
        if (request !== requestRef.current) return null;
        const size = readSize();
        stableFrames = size > 0 && Math.abs(size - previous) < 0.5 ? stableFrames + 1 : 0;
        previous = size;
        if (stableFrames >= 2) break;
      }
      return previous;
    };
    // The fragment's load event fires before the paginator publishes its
    // contents. Give it one layout frame before awaiting those reading fonts.
    await new Promise(requestAnimationFrame);
    if (request !== requestRef.current) return;
    // A missing local font falls back to the browser's reading font; it must
    // not leave the reader behind an invisible, blocking popup.
    await ready().catch(() => undefined);
    if (request !== requestRef.current) return;
    let size = await measure();
    if (size === null) return;
    const popup = footnoteRef.current!.parentElement!;
    const border = bounds.vertical
      ? popup.offsetWidth - popup.clientWidth
      : popup.offsetHeight - popup.clientHeight;
    const backMargin = canGoBackRef.current ? 32 : 0;
    size += border + backMargin;
    let { width, height } = bounds;
    if (bounds.vertical && size > bounds.maxWidth && height < bounds.maxHeight) {
      height = bounds.maxHeight;
      setResponsiveHeight(height);
      size = (await measure()) ?? 0;
      size += border + backMargin;
    } else if (!bounds.vertical && size > bounds.maxHeight && width < bounds.maxWidth) {
      width = bounds.maxWidth;
      setResponsiveWidth(width);
      size = (await measure()) ?? 0;
      size += border + backMargin;
    }
    if (request !== requestRef.current) return;
    if (bounds.vertical) width = Math.min(bounds.maxWidth, Math.ceil(size));
    else height = Math.min(bounds.maxHeight, Math.ceil(size));
    setResponsiveWidth(width);
    setResponsiveHeight(height);
    if ((await measure()) === null) return;
    finish?.();
    setIsPreparing(false);
    setShowPopup(true);
  };

  const openFootnote = (event: Event) => {
    const request = ++requestRef.current;
    const bounds = preparePopup();
    // Each navigation owns its handler so a late previous load cannot replace
    // the current note or reopen a popup the reader has dismissed.
    const footnoteHandler = new FootnoteHandler();
    const getHashFromHref = (href: string | null) => {
      if (!href) return null;
      const hashIndex = href.indexOf('#');
      if (hashIndex !== -1) {
        return href.substring(hashIndex + 1);
      }
      return null;
    };
    const handleBeforeRender = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const { view } = detail;
      if (request !== requestRef.current) {
        view.close();
        return;
      }
      view.addEventListener('link', (e: Event) => {
        e.preventDefault();
        const { detail: popupLinkDetail } = e as CustomEvent;
        const footnoteAnchorId = getHashFromHref(footnoteHrefRef.current);
        const linkAnchor = popupLinkDetail.a as HTMLAnchorElement;
        if (linkAnchor && linkAnchor.getAttribute('id') === footnoteAnchorId) return;

        popupLinkDetail['follow'] = true;
        const history = historyRef.current;
        const items = [...history.items.slice(0, history.index + 1), popupLinkDetail];
        historyRef.current = { items, index: items.length - 1 };
        setCanGoBack(true);
        canGoBackRef.current = true;
        openFootnote(e);
      });
      view.addEventListener('load', (e: CustomEvent) => {
        const { doc } = e.detail;
        const bookData = getBookData(bookKey)!;
        mountAdditionalFonts(doc, bookData.book?.primaryLanguage);
        getLoadedFonts().forEach((font) => {
          mountCustomFont(doc, font);
        });
      });
      footnoteViewRef.current?.close();
      footnoteViewRef.current = view;
      footnoteRef.current?.replaceChildren(view);
      const { renderer } = view;
      scrollCleanupRef.current?.();
      renderer.addEventListener('scroll', handleScroll);
      scrollCleanupRef.current = () => renderer.removeEventListener('scroll', handleScroll);
      // Focus the actual scroll viewport so native Page Up/Down and Home/End
      // work without handing those keys back to the underlying book.
      renderer.shadowRoot?.querySelector('[part~="container"]')?.setAttribute('tabindex', '0');
      const viewSettings = getViewSettings(bookKey)!;
      const backButtonMargin = canGoBackRef.current ? 32 : 0;
      renderer.setAttribute('flow', 'scrolled');
      renderer.setAttribute('no-preload', '');
      renderer.setAttribute('no-background', '');
      renderer.setAttribute('margin-top', `${viewSettings.vertical ? 0 : backButtonMargin}px`);
      renderer.setAttribute('margin-right', `${viewSettings.vertical ? backButtonMargin : 0}px`);
      renderer.setAttribute('margin-bottom', '0px');
      renderer.setAttribute('margin-left', '0px');
      renderer.setAttribute('gap', '0%');
      const themeCode = getThemeCode();
      const popupTheme = { ...themeCode };
      const popupContainer = document.getElementById('popup-container');
      if (popupContainer) {
        const backgroundColor = getComputedStyle(popupContainer).backgroundColor;
        popupTheme.bg = backgroundColor;
      }
      const mainStyles = getStyles(viewSettings, popupTheme, getLoadedFonts());
      const footnoteStyles = getFootnoteStyles();
      renderer.setStyles?.(`${mainStyles}\n${footnoteStyles}`);
    };

    const handleRender = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const { view, href } = detail as { view: FoliateView; href: string };
      if (request !== requestRef.current) {
        view.close();
        return;
      }
      footnoteHrefRef.current = href;
      const { renderer } = view;
      const ready = () => Promise.all(renderer.getContents().map(({ doc }) => doc.fonts.ready));
      void fitPopup(() => renderer.viewSize, request, bounds, ready);
    };

    footnoteHandler.addEventListener('before-render', handleBeforeRender);
    footnoteHandler.addEventListener('render', handleRender);
    const pending = footnoteHandler.handle(bookDoc, event);
    if (!pending) setIsPreparing(false);
    pending?.catch((err) => {
      if (request !== requestRef.current) return;
      console.warn(err);
      handleDismissPopup();
      view?.goTo((event as CustomEvent).detail.href);
    });
  };

  useEffect(() => {
    if (showPopup) {
      const view = footnoteRef.current?.querySelector<FoliateView>('foliate-view');
      const viewport = view?.renderer.shadowRoot?.querySelector<HTMLElement>('[part~="container"]');
      (viewport ?? footnoteRef.current?.querySelector<HTMLElement>('.footnote-text'))?.focus({
        preventScroll: true,
      });
    }
  }, [showPopup]);

  const docLinkHandler = async (event: Event) => {
    const detail = (event as CustomEvent).detail;
    // console.log('doc link click', detail);
    const gridFrame = document.querySelector(`#gridcell-${bookKey}`);
    if (!gridFrame) return;
    const rect = gridFrame.getBoundingClientRect();
    const viewSettings = getViewSettings(bookKey)!;
    const triangPos = getPosition(detail.a, rect, popupPadding, viewSettings.vertical);
    gridRectRef.current = rect;
    setTrianglePosition(triangPos);
    trianglePositionRef.current = triangPos;

    const { a: anchor } = detail as { a: HTMLAnchorElement };
    const footnoteClasses = ['duokan-footnote', 'footnote-link', 'footnote'];
    if (footnoteClasses.some((cls) => anchor.classList.contains(cls))) {
      detail['follow'] = true;
    }
    if (shouldCheckAsFootnote(anchor)) {
      detail['check'] = true;
    }
    historyRef.current = { items: [detail], index: 0 };
    setCanGoBack(false);
    canGoBackRef.current = false;
    openFootnote(event);
  };

  const handleBack = () => {
    const history = historyRef.current;
    if (history.index <= 0) return;
    const newIndex = history.index - 1;
    historyRef.current = { ...history, index: newIndex };
    setCanGoBack(newIndex > 0);
    canGoBackRef.current = newIndex > 0;
    const detail = history.items[newIndex]!;
    const syntheticEvent = new CustomEvent('link', {
      detail: { ...detail, follow: true },
      cancelable: true,
    });
    openFootnote(syntheticEvent);
  };

  const closePopup = () => {
    requestRef.current += 1;
    scrollCleanupRef.current?.();
    scrollCleanupRef.current = null;
    hideScrollbar();
    footnoteViewRef.current?.close();
    footnoteViewRef.current?.remove();
    footnoteViewRef.current = null;
  };

  const handleDismissPopup = () => {
    closePopup();
    historyRef.current = { items: [], index: -1 };
    canGoBackRef.current = false;
    trianglePositionRef.current = null;
    setCanGoBack(false);
    gridRectRef.current = null;
    setTrianglePosition(null);
    setResponsiveWidth(popupWidth);
    setResponsiveHeight(popupHeight);
    setShowPopup(false);
    setIsPreparing(false);
  };

  // Handle custom footnote popup event from iframe event
  const handleFootnotePopupEvent = (event: CustomEvent) => {
    const { element, footnote } = event.detail;
    const gridFrame = document.querySelector(`#gridcell-${bookKey}`);
    if (!gridFrame) return;
    const rect = gridFrame.getBoundingClientRect();
    const viewSettings = getViewSettings(bookKey)!;
    const triangPos = getPosition(element, rect, popupPadding, viewSettings.vertical);
    if (footnoteRef.current) {
      closePopup();
      historyRef.current = { items: [], index: -1 };
      canGoBackRef.current = false;
      setCanGoBack(false);
      gridRectRef.current = rect;
      setTrianglePosition(triangPos);
      trianglePositionRef.current = triangPos;
      const request = ++requestRef.current;
      const bounds = preparePopup();
      const elem = document.createElement('p');
      elem.textContent = footnote;
      elem.className = 'footnote-text';
      elem.tabIndex = 0;
      elem.setAttribute('style', `padding: 1em; hanging-punctuation: allow-end last;`);
      const bodyStyle = element.ownerDocument.defaultView?.getComputedStyle(
        element.ownerDocument.body,
      );
      if (bodyStyle) {
        elem.style.fontFamily = bodyStyle.fontFamily;
        elem.style.fontSize = bodyStyle.fontSize;
        elem.style.lineHeight = bodyStyle.lineHeight;
      }
      elem.style.writingMode = viewSettings.vertical ? 'vertical-rl' : 'horizontal-tb';
      elem.style.width = bounds.vertical ? 'max-content' : '100%';
      elem.style.height = bounds.vertical ? '100%' : 'auto';
      footnoteRef.current.replaceChildren(elem);
      void fitPopup(
        () => elem.getBoundingClientRect()[bounds.vertical ? 'width' : 'height'],
        request,
        bounds,
        () =>
          document.fonts.load(
            `${elem.style.fontSize || '16px'} ${elem.style.fontFamily || 'serif'}`,
            footnote,
          ),
        () => {
          elem.style.width = '100%';
          elem.style.height = '100%';
        },
      );
    }
  };

  useFoliateEvents(view, {
    onLinkClick: docLinkHandler,
  });

  useKeyDownActions({
    onCancel: handleDismissPopup,
    elementRef: containerRef,
    enabled: isPreparing,
  });

  useEffect(() => {
    window.addEventListener('resize', handleDismissPopup);
    eventDispatcher.on('footnote-popup', handleFootnotePopupEvent);
    return () => {
      window.removeEventListener('resize', handleDismissPopup);
      eventDispatcher.off('footnote-popup', handleFootnotePopupEvent);
      closePopup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className='footnote-popup'
      ref={containerRef}
      role='toolbar'
      tabIndex={-1}
      onScrollCapture={handleScroll}
    >
      {(showPopup || isPreparing) && <Overlay onDismiss={handleDismissPopup} />}
      <Popup
        isOpen={showPopup}
        width={responsiveWidth}
        height={responsiveHeight}
        position={showPopup ? popupPosition! : undefined}
        trianglePosition={showPopup ? trianglePosition! : undefined}
        className='select-text overflow-hidden'
        additionalStyle={{ visibility: showPopup ? 'visible' : 'hidden' }}
        onDismiss={handleDismissPopup}
      >
        {canGoBack && (
          <div
            className={clsx(
              'absolute flex h-8 w-full pt-2',
              viewSettings.vertical ? 'justify-end pe-2' : 'justify-start ps-2',
            )}
          >
            <button
              type='button'
              onClick={handleBack}
              className={clsx(
                'btn btn-ghost btn-circle eink-bordered text-base-content bg-base-200/80 hover:bg-base-200',
                'z-10 h-8 min-h-8 w-8 p-0 shadow-sm',
              )}
            >
              <MdArrowBack size={size18} />
            </button>
          </div>
        )}
        <div
          className='footnote-content'
          ref={footnoteRef}
          data-vertical={viewSettings.vertical ? 'true' : 'false'}
        ></div>
      </Popup>
    </div>
  );
};

export default FootnotePopup;
