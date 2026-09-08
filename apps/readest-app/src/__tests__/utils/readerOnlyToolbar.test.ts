import { describe, expect, it } from 'vitest';
import {
  getToolbarToolTypes,
  getAvailableToolTypes,
  getReadingQuickAction,
} from '@/utils/annotationToolbar';

describe('reader-only selection toolbar', () => {
  it('keeps basic reading actions for new readers', () => {
    expect(getToolbarToolTypes(undefined)).toEqual(['copy', 'highlight', 'annotate', 'search']);
  });

  it('ignores removed actions in existing synced settings without losing annotations', () => {
    expect(
      getToolbarToolTypes([
        'dictionary',
        'highlight',
        'translate',
        'tts',
        'annotate',
        'proofread',
        'search',
      ]),
    ).toEqual(['highlight', 'annotate', 'search']);
    expect(getAvailableToolTypes([])).not.toContain('tts');
  });
});

describe('legacy quick actions', () => {
  it('falls back to the toolbar for removed actions', () => {
    expect(getReadingQuickAction('dictionary')).toBeNull();
    expect(getReadingQuickAction('tts')).toBeNull();
    expect(getReadingQuickAction('highlight')).toBe('highlight');
  });
});
