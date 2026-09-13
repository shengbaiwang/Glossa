import { describe, expect, it } from 'vitest';
import {
  getToolbarToolTypes,
  getAvailableToolTypes,
  getReadingQuickAction,
} from '@/utils/annotationToolbar';

describe('reading selection toolbar', () => {
  it('keeps basic reading actions for new readers', () => {
    expect(getToolbarToolTypes(undefined)).toEqual([
      'copy',
      'highlight',
      'annotate',
      'dictionary',
      'translate',
      'tts',
      'search',
    ]);
  });

  it('restores lookup and speech actions in existing synced settings without losing annotations', () => {
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
    ).toEqual(['dictionary', 'highlight', 'translate', 'tts', 'annotate', 'search']);
    expect(getAvailableToolTypes([])).toContain('tts');
  });
});

describe('legacy quick actions', () => {
  it('restores saved reading quick actions', () => {
    expect(getReadingQuickAction('dictionary')).toBe('dictionary');
    expect(getReadingQuickAction('tts')).toBe('tts');
    expect(getReadingQuickAction('highlight')).toBe('highlight');
  });
});
