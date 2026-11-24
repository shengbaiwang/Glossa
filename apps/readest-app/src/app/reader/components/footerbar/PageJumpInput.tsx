import clsx from 'clsx';
import React, { useEffect, useRef, useState } from 'react';
import { useReaderStore } from '@/store/readerStore';
import { useBookProgress } from '@/store/readerProgressStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useBookDataStore } from '@/store/bookDataStore';
import { formatProgress, getReferencePageInfo } from '@/utils/progress';
import { clampPage, findReferencePageHref, fractionForPage, parsePageInput } from './pageJump';

interface PageJumpInputProps {
  bookKey: string;
  /** Always show '{current} / {total}' regardless of the progress style. */
  showFraction?: boolean;
  className?: string;
}

/**
 * The footer bar's progress label, editable in place: clicking it selects the
 * current page number inside the "94 / 251" text so a target page can be
 * typed over it. Enter jumps there; Escape or blur cancels. An invisible
 * sizer span reserves the label's width so toggling edit mode never shifts
 * the surrounding layout.
 */
const PageJumpInput: React.FC<PageJumpInputProps> = ({ bookKey, showFraction, className }) => {
  const _ = useTranslation();
  const { hoveredBookKey, getView, getProgress, getViewSettings } = useReaderStore();
  const { getBookData } = useBookDataStore();
  const view = getView(bookKey);
  const bookData = getBookData(bookKey);
  const progress = useBookProgress(bookKey) ?? getProgress(bookKey);
  const viewSettings = getViewSettings(bookKey);
  const progressStyle = viewSettings?.progressStyle || 'percentage';
  const isPDF = bookData?.book?.format === 'PDF';

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [selectLength, setSelectLength] = useState(0);
  const [fileEntry, setFileEntry] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const pending = useRef<AbortController | null>(null);
  const entryTotal = useRef(0);
  const entryPrinted = useRef(false);
  const { section, pageinfo } = progress || {};
  const pageInfo = bookData?.isFixedLayout ? section : pageinfo;
  const pageIndex = pageInfo?.current ?? -1;
  const bookDoc = bookData?.bookDoc;
  const [printedPage, setPrintedPage] = useState<{
    book: typeof bookDoc;
    index: number;
    number: number;
    total: number;
  } | null>(null);

  useEffect(() => {
    if (!isPDF || pageIndex < 0 || !bookDoc?.getPDFPrintedPage) return;
    let active = true;
    void bookDoc.getPDFPrintedPage(pageIndex).then(
      (folio) => {
        if (active) setPrintedPage(folio && { ...folio, book: bookDoc, index: pageIndex });
      },
      () => {},
    );
    return () => {
      active = false;
    };
  }, [isPDF, bookDoc, pageIndex]);

  useEffect(() => () => pending.current?.abort(), [view, bookDoc]);

  useEffect(() => {
    if (!editing) return;
    // Select the current page portion so typing replaces it. The rAF runs
    // after the browser's own click handling, which would otherwise collapse
    // the selection to a caret on mouse-up.
    const raf = requestAnimationFrame(() => {
      inputRef.current?.setSelectionRange(0, selectLength);
    });
    return () => cancelAnimationFrame(raf);
  }, [editing, selectLength, fileEntry]);

  useEffect(() => {
    // The footer bar hid (or another book took focus) mid-edit.
    if (hoveredBookKey !== bookKey && document.activeElement === inputRef.current) {
      inputRef.current?.blur();
    }
  }, [hoveredBookKey, bookKey]);

  const progressValid = !!pageInfo && pageInfo.total > 0 && pageInfo.current >= 0;
  if (!progressValid) return null;

  const progressFraction = (pageInfo.current + 1) / pageInfo.total;
  const referenceInfo =
    !isPDF && progressStyle === 'reference'
      ? getReferencePageInfo({
          pageList: bookData?.bookDoc?.pageList,
          pageItem: progress?.pageItem,
          fraction: progressFraction,
          referencePageCount: viewSettings?.referencePageCount,
        })
      : null;
  const template =
    showFraction || progressStyle === 'fraction' ? '{current} / {total}' : '{percent}%';
  const folio =
    printedPage && printedPage.book === bookDoc && printedPage.index === pageIndex
      ? printedPage
      : null;
  const displayText = folio
    ? `${folio.number} / ${folio.total}`
    : referenceInfo
      ? `${referenceInfo.current} / ${referenceInfo.total}`
      : formatProgress(pageInfo.current, pageInfo.total, template, false, 'en', 0);

  const total = referenceInfo ? referenceInfo.total : pageInfo.total;
  const currentLabel = referenceInfo ? referenceInfo.current : String(pageInfo.current + 1);
  const printed = isPDF ? bookDoc?.pageList?.[pageIndex]?.label : null;
  const printedText =
    printed && printed !== currentLabel ? _('Printed page {{page}}', { page: printed }) : '';
  const fileText = _('File page {{page}} of {{total}}', { page: currentLabel, total });

  // Freeze the meaning of a draft while scrolling or loading another folio.
  const beginEditing = (useFilePage: boolean) => {
    const target = useFilePage ? null : folio;
    const label = target ? String(target.number) : currentLabel;
    entryPrinted.current = !!target;
    entryTotal.current = target?.total ?? total;
    setDraft(`${label} / ${entryTotal.current}`);
    setSelectLength(label.length);
    setFileEntry(useFilePage && !!folio);
    setInvalid(false);
    setEditing(true);
  };

  const jumpToPage = (page: number) => {
    if (!view) return;
    const target = clampPage(page, entryTotal.current);
    if (referenceInfo) {
      const href = findReferencePageHref(bookData?.bookDoc?.pageList, target);
      if (href) view.goTo(href);
      else view.goToFraction(fractionForPage(target, total));
    } else if (bookData?.isFixedLayout) {
      view.goTo(target - 1);
    } else {
      view.goToFraction(fractionForPage(target, total));
    }
  };

  const stopEditing = () => {
    setEditing(false);
    inputRef.current?.blur();
  };

  const commitDraft = async () => {
    const page = parsePageInput(draft.normalize('NFKC'));
    if (isPDF && (page === null || page > entryTotal.current)) {
      setInvalid(true);
      return;
    }
    if (page !== null && entryPrinted.current && view?.navigate) {
      pending.current?.abort();
      const request = new AbortController();
      pending.current = request;
      const result = await view.navigate(`pdf-printed-page:${page}/${entryTotal.current}`, {
        signal: request.signal,
      });
      if (request.signal.aborted) return;
      pending.current = null;
      if (result.status === 'failed') {
        setInvalid(true);
        return;
      }
    } else if (page !== null) {
      jumpToPage(page);
    }
    stopEditing();
  };

  const text = editing ? draft : displayText;

  return (
    <div className='glossa-page-position'>
      <label className='flex flex-col items-center'>
        <span
          dir='ltr'
          data-editing={editing}
          className={clsx(
            'glossa-reader-page-input relative flex items-center rounded-md text-nowrap transition-colors',
            editing ? 'eink-bordered' : 'cursor-pointer bg-transparent',
            invalid && 'outline outline-1 outline-error',
            className,
          )}
        >
          {/* Invisible sizer: the box is always as wide as its text, so swapping
          between label and edit modes never shifts the surrounding layout. */}
          <span aria-hidden='true' className='invisible whitespace-pre px-1 py-0.5'>
            {text}
          </span>
          <input
            ref={inputRef}
            type='text'
            inputMode='numeric'
            enterKeyHint='go'
            title={
              invalid
                ? _('Page not found')
                : fileEntry
                  ? fileText
                  : folio
                    ? _('Printed page {{page}}', { page: folio.number })
                    : printedText || _('Go to Page')
            }
            aria-label={_('Go to Page')}
            aria-invalid={invalid || undefined}
            value={text}
            className='absolute inset-0 h-full w-full bg-transparent text-center focus:outline-none'
            onFocus={() => beginEditing(false)}
            onBlur={() => {
              pending.current?.abort();
              pending.current = null;
              setEditing(false);
              setFileEntry(false);
              setInvalid(false);
            }}
            onChange={(e) => {
              pending.current?.abort();
              pending.current = null;
              setInvalid(false);
              setDraft(e.target.value);
            }}
            onKeyDownCapture={(e) => {
              // Keep keystrokes away from the reader's page-turn shortcuts and
              // the footer bar's spatial navigation.
              e.stopPropagation();
              if (e.nativeEvent.isComposing) return;
              if (e.key === 'Enter') {
                e.preventDefault();
                void commitDraft();
              } else if (e.key === 'Escape') stopEditing();
            }}
          />
        </span>
        {!folio && printedText && !invalid && (
          <span className='glossa-pdf-printed-page' title={printedText}>
            {printedText}
          </span>
        )}
      </label>
      {invalid ? (
        <span className='glossa-pdf-printed-page' role='status'>
          {_('Page not found')}
        </span>
      ) : folio ? (
        <button
          type='button'
          className='glossa-pdf-printed-page cursor-pointer underline-offset-2 hover:underline focus-visible:underline'
          title={fileText}
          onClick={() => {
            inputRef.current?.focus();
            beginEditing(true);
          }}
        >
          {fileText}
        </button>
      ) : null}
    </div>
  );
};

export default PageJumpInput;
