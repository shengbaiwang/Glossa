import { describe, test, expect } from 'vitest';
import { annotationToolButtons } from '@/app/reader/components/annotator/AnnotationTools';
import {
  ALL_ANNOTATION_TOOL_TYPES,
  DEFAULT_ANNOTATION_TOOLBAR_ITEMS,
  getToolbarToolTypes,
  getAvailableToolTypes,
  addToolToToolbar,
  removeToolFromToolbar,
  reorderToolbar,
} from '@/utils/annotationToolbar';

describe('annotationToolbar helpers', () => {
  test('ALL_ANNOTATION_TOOL_TYPES matches the button registry order', () => {
    expect(ALL_ANNOTATION_TOOL_TYPES).toEqual(annotationToolButtons.map((b) => b.type));
  });

  test('default toolbar is the basic reading tools in canonical order', () => {
    expect(DEFAULT_ANNOTATION_TOOLBAR_ITEMS).toEqual(['copy', 'highlight', 'annotate', 'search']);
    expect(DEFAULT_ANNOTATION_TOOLBAR_ITEMS).not.toContain('share');
  });

  test('copylink is opt-in: off the default toolbar, offered in the available tray', () => {
    expect(ALL_ANNOTATION_TOOL_TYPES).toContain('copylink');
    expect(DEFAULT_ANNOTATION_TOOLBAR_ITEMS).not.toContain('copylink');
    expect(getToolbarToolTypes(undefined)).not.toContain('copylink');
    expect(getAvailableToolTypes(DEFAULT_ANNOTATION_TOOLBAR_ITEMS)).toContain('copylink');
    expect(getToolbarToolTypes([...DEFAULT_ANNOTATION_TOOLBAR_ITEMS, 'copylink'])).toContain(
      'copylink',
    );
  });

  test('getToolbarToolTypes preserves order and falls back to default when undefined', () => {
    expect(getToolbarToolTypes(undefined)).toEqual(DEFAULT_ANNOTATION_TOOLBAR_ITEMS);
    expect(getToolbarToolTypes(['search', 'copy'])).toEqual(['search', 'copy']);
  });

  test('getToolbarToolTypes drops the removed share tool', () => {
    expect(getToolbarToolTypes(['copy', 'share'])).toEqual(['copy']);
    expect(getToolbarToolTypes(['copy', 'share'])).toEqual(['copy']);
  });

  test('getToolbarToolTypes drops unknown/duplicate entries', () => {
    expect(getToolbarToolTypes(['copy', 'copy', 'bogus' as never])).toEqual(['copy']);
  });

  test('getAvailableToolTypes returns canonical-order complement', () => {
    expect(getAvailableToolTypes(['copy'])).toEqual([
      'copylink',
      'highlight',
      'annotate',
      'search',
    ]);
  });

  test('getAvailableToolTypes hides share when !canShare', () => {
    expect(getAvailableToolTypes(['copy'])).not.toContain('share');
  });

  test('addToolToToolbar appends by default and is a no-op when present', () => {
    expect(addToolToToolbar(['copy'], 'share')).toEqual(['copy', 'share']);
    expect(addToolToToolbar(['copy', 'share'], 'share')).toEqual(['copy', 'share']);
  });

  test('addToolToToolbar inserts at the given index', () => {
    expect(addToolToToolbar(['copy', 'search'], 'share', 1)).toEqual(['copy', 'share', 'search']);
  });

  test('removeToolFromToolbar removes the tool', () => {
    expect(removeToolFromToolbar(['copy', 'share'], 'share')).toEqual(['copy']);
    expect(removeToolFromToolbar(['copy'], 'share')).toEqual(['copy']);
  });

  test('reorderToolbar moves a tool to another tool position', () => {
    expect(reorderToolbar(['copy', 'highlight', 'search'], 'search', 'copy')).toEqual([
      'search',
      'copy',
      'highlight',
    ]);
    expect(reorderToolbar(['copy', 'search'], 'copy', 'copy')).toEqual(['copy', 'search']);
  });
});
