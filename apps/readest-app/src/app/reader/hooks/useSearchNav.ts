import { useCallback, useEffect, useMemo } from 'react';
import { useSidebarStore } from '@/store/sidebarStore';
import { useReaderStore } from '@/store/readerStore';
import { useBookProgress } from '@/store/readerProgressStore';
import { createCfiLocationMatcher } from '@/utils/cfi';
import { flattenSearchResults } from '../components/sidebar/SearchResultsNav';

export function useSearchNav(bookKey: string) {
  const getView = useReaderStore((s) => s.getView);
  const { setSideBarVisible, setSearchBarVisible } = useSidebarStore();
  const { getSearchNavState, setSearchResultIndex, clearSearch } = useSidebarStore();

  const searchNavState = getSearchNavState(bookKey);
  const { searchTerm, searchResults, searchResultIndex, searchProgress, searchOrigin } =
    searchNavState;

  // Reactive: search nav re-derives current-page boundaries when the user
  // turns the page. Subscribes to readerProgressStore only.
  const progress = useBookProgress(bookKey);

  const currentLocation = useMemo(() => {
    return progress?.location;
  }, [progress]);

  // Flatten search results for navigation
  const flattenedResults = useMemo(() => {
    if (!searchResults) return [];
    return flattenSearchResults(searchResults);
  }, [searchResults]);

  const totalResults = flattenedResults.length;
  const hasSearchResults = searchResults && totalResults > 0;
  const showSearchNav = hasSearchResults;

  // Get current section label
  const currentSection = useMemo(() => {
    if (!flattenedResults.length || searchResultIndex >= flattenedResults.length) return '';
    return flattenedResults[searchResultIndex]?.sectionLabel || '';
  }, [flattenedResults, searchResultIndex]);

  // Find results on the current page.
  // Uses a batched CFI matcher so the location is collapsed only once per
  // page turn instead of once per search hit — see createCfiLocationMatcher
  // in utils/cfi for the why.
  const currentPageResults = useMemo(() => {
    if (!flattenedResults.length || !currentLocation) return { firstIndex: -1, lastIndex: -1 };

    const matches = createCfiLocationMatcher(currentLocation);
    let firstIndex = -1;
    let lastIndex = -1;

    for (let i = 0; i < flattenedResults.length; i++) {
      const result = flattenedResults[i];
      if (result && matches(result.cfi)) {
        if (firstIndex === -1) firstIndex = i;
        lastIndex = i;
      }
    }

    return { firstIndex, lastIndex };
  }, [flattenedResults, currentLocation, bookKey, setSearchResultIndex]);

  useEffect(() => {
    const { firstIndex, lastIndex } = currentPageResults;
    const index = getSearchNavState(bookKey).searchResultIndex;
    if (firstIndex >= 0 && (index < firstIndex || index > lastIndex)) {
      setSearchResultIndex(bookKey, firstIndex);
    }
  }, [bookKey, currentPageResults, getSearchNavState, setSearchResultIndex]);

  // Highlight the current match in the book with a stronger style; clearing
  // when the index leaves the result range (e.g. search closed or re-run).
  useEffect(() => {
    const view = getView(bookKey);
    const cfi =
      searchResultIndex >= 0 && searchResultIndex < flattenedResults.length
        ? flattenedResults[searchResultIndex]?.cfi
        : null;
    view?.setSearchMatchActive(cfi ?? null);
  }, [bookKey, getView, flattenedResults, searchResultIndex]);

  // Navigate to a specific search result
  const navigateToResult = useCallback(
    (index: number) => {
      if (!flattenedResults.length) return;
      if (index < 0 || index >= flattenedResults.length) return;

      const result = flattenedResults[index];
      if (result) {
        setSearchResultIndex(bookKey, index);
        getView(bookKey)?.goTo(result.cfi);
      }
    },
    [bookKey, flattenedResults, setSearchResultIndex, getView],
  );

  const handleShowResults = useCallback(() => {
    setSideBarVisible(true);
    setSearchBarVisible(true);
  }, [setSideBarVisible, setSearchBarVisible]);

  const handleCloseSearch = useCallback(() => {
    clearSearch(bookKey);
    // Exit the sidebar's search mode too, not just the results — otherwise
    // reopening the sidebar still shows the (empty) search bar.
    setSearchBarVisible(false);
    getView(bookKey)?.clearSearch();
  }, [clearSearch, bookKey, getView, setSearchBarVisible]);

  const handlePreviousResult = useCallback(
    () => navigateToResult(searchResultIndex - 1),
    [navigateToResult, searchResultIndex],
  );
  const handleNextResult = useCallback(
    () => navigateToResult(searchResultIndex + 1),
    [navigateToResult, searchResultIndex],
  );
  const hasPreviousPage = searchResultIndex > 0;
  const hasNextPage = searchResultIndex < totalResults - 1;
  const handleReturnToReading = useCallback(() => {
    if (searchOrigin) {
      void getView(bookKey)?.goTo(searchOrigin);
      handleCloseSearch();
    }
  }, [bookKey, searchOrigin, getView, handleCloseSearch]);

  return {
    searchTerm,
    searchOrigin,
    handleReturnToReading,
    searchProgress,
    currentSection,
    searchResultIndex,
    totalResults,
    showSearchNav,
    hasPreviousPage,
    hasNextPage,
    handleShowResults,
    handleCloseSearch,
    handlePreviousResult,
    handleNextResult,
  };
}
