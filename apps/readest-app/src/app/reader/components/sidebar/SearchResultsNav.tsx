import React from 'react';

import { Insets } from '@/types/misc';
import { BookSearchMatch, BookSearchResult } from '@/types/book';
import { useTranslation } from '@/hooks/useTranslation';
import { useReaderStore } from '@/store/readerStore';
import { useSearchNav } from '../../hooks/useSearchNav';
import { ArrowLeft, ChevronLeft, ChevronRight, List, X } from '@/components/GlossaIcons';

interface SearchResultsNavProps {
  bookKey: string;
  gridInsets: Insets;
}

const SearchResultsNav: React.FC<SearchResultsNavProps> = ({ bookKey, gridInsets }) => {
  const {
    searchTerm,
    searchResultIndex,
    totalResults,
    searchOrigin,
    handleReturnToReading,
    showSearchNav,
    hasPreviousPage,
    hasNextPage,
    handleShowResults,
    handleCloseSearch,
    handlePreviousResult,
    handleNextResult,
  } = useSearchNav(bookKey);
  const _ = useTranslation();
  const { hoveredBookKey } = useReaderStore();

  if (!showSearchNav || hoveredBookKey === bookKey) {
    return null;
  }

  return (
    <div
      className='glossa-search-nav-position'
      style={{
        left: gridInsets.left,
        right: gridInsets.right,
        bottom: Math.max(8, gridInsets.bottom / 4),
      }}
    >
      <nav className='glossa-search-nav eink-bordered' aria-label={_('Search results')}>
        {searchOrigin && (
          <button
            className='glossa-icon-button'
            title={_('Return to reading')}
            aria-label={_('Return to reading')}
            onClick={handleReturnToReading}
          >
            <ArrowLeft size={16} className='rtl:rotate-180' />
          </button>
        )}
        <button
          className='glossa-icon-button'
          title={_('Show Search Results')}
          aria-label={_('Show Search Results')}
          onClick={handleShowResults}
        >
          <List size={16} />
        </button>
        <span className='glossa-search-nav-term' title={searchTerm} dir='auto'>
          {searchTerm}
        </span>
        <span className='glossa-search-nav-count' role='status' dir='ltr'>
          {searchResultIndex + 1} / {totalResults}
        </span>
        <button
          className='glossa-icon-button'
          title={_('Previous Result')}
          aria-label={_('Previous Result')}
          disabled={!hasPreviousPage}
          onClick={handlePreviousResult}
        >
          <ChevronLeft size={16} className='rtl:rotate-180' />
        </button>
        <button
          className='glossa-icon-button'
          title={_('Next Result')}
          aria-label={_('Next Result')}
          disabled={!hasNextPage}
          onClick={handleNextResult}
        >
          <ChevronRight size={16} className='rtl:rotate-180' />
        </button>
        <button
          className='glossa-icon-button'
          title={_('Close Search')}
          aria-label={_('Close Search')}
          onClick={handleCloseSearch}
        >
          <X size={16} />
        </button>
      </nav>
    </div>
  );
};

export default SearchResultsNav;

// Helper function to flatten search results into a single array of matches with section labels
export function flattenSearchResults(
  results: BookSearchResult[] | BookSearchMatch[],
): { cfi: string; sectionLabel: string }[] {
  const flattened: { cfi: string; sectionLabel: string }[] = [];

  for (const result of results) {
    if ('subitems' in result) {
      // BookSearchResult with subitems
      for (const item of result.subitems) {
        flattened.push({ cfi: item.cfi, sectionLabel: result.label });
      }
    } else {
      // BookSearchMatch
      flattened.push({ cfi: result.cfi, sectionLabel: '' });
    }
  }

  return flattened;
}

// Helper function to find the index of current result based on CFI
export function findCurrentResultIndex(
  flattenedResults: { cfi: string; sectionLabel: string }[],
  currentLocation: string | undefined,
): number {
  if (!currentLocation || flattenedResults.length === 0) return 0;

  // Try to find exact match or closest match
  for (let i = 0; i < flattenedResults.length; i++) {
    if (flattenedResults[i]!.cfi === currentLocation) {
      return i;
    }
  }

  return 0;
}
