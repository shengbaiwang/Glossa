export const isChunkLoadError = (error: Error) =>
  error.name === 'ChunkLoadError' ||
  /Loading chunk .+ failed|Failed to load chunk|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(
    error.message,
  );

export const handleGlobalError = (e: Error) => {
  // Keep the error page available while its server is unreachable. The user's
  // retry reloads the document to discard the cached React.lazy rejection.
  if (!isChunkLoadError(e)) {
    const now = Date.now();
    const lastReload = Number(sessionStorage.getItem('lastErrorReload') || '0');
    if (now - lastReload > 60_000) {
      sessionStorage.setItem('lastErrorReload', String(now));
      window.location.reload();
    } else {
      console.warn('Error detected, but reload suppressed (rate limit)');
    }
  }
};
