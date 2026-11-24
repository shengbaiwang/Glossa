import type { ViewSettings } from '@/types/book';

export function fixedSpreadMode(settings: ViewSettings, isPDF: boolean) {
  if (settings.spreadMode !== 'atlas') return settings.spreadMode;
  if (!isPDF) return 'auto';
  return (settings.hasCoverPage ?? true) ? 'atlas-cover' : 'atlas';
}

export function atlasTrimAttribute(trim: ViewSettings['gutterTrim']) {
  return trim ? `${trim.value}${trim.unit}` : '0%';
}
