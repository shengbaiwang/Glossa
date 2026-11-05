/** Opt-in, bounded, local-only evidence. Never include paths, titles or book text. */
type Entry = { event: string; time: number; detail: Record<string, string | number | boolean> };
const entries: Entry[] = [];

export function recordLibraryDiagnostic(event: string, detail: Entry['detail'] = {}) {
  try {
    if (sessionStorage.getItem('glossa-library-diagnostics') !== '1') return;
    entries.push({ event, time: performance.now(), detail });
    if (entries.length > 200) entries.shift();
    sessionStorage.setItem('glossa-library-diagnostic-log', JSON.stringify(entries));
  } catch {
    // Storage can be unavailable; diagnostics must not affect reading.
  }
}

export function readLibraryDiagnostics(): readonly Entry[] {
  return entries.map((entry) => ({ ...entry, detail: { ...entry.detail } }));
}
