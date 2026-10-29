import { describe, expect, it } from 'vitest';
import { resolveLibrarySelection as select } from '@/app/library/utils/librarySelection';

const order = ['folder', 'a', 'b', 'c'];
describe('library file selection', () => {
  it('replaces plain selection and toggles with a modifier for both files and folders', () => {
    expect(select(['a', 'b'], 'a', 'folder', order)).toEqual({
      selected: ['folder'],
      anchor: 'folder',
    });
    expect(select(['folder'], 'folder', 'b', order, { toggle: true })).toEqual({
      selected: ['folder', 'b'],
      anchor: 'b',
    });
    expect(select(['folder', 'b'], 'b', 'folder', order, { toggle: true }).selected).toEqual(['b']);
  });
  it('extends and shrinks a range from the original anchor instead of accumulating old ranges', () => {
    const forward = select(['a'], 'a', 'c', order, { range: true });
    expect(forward).toEqual({ selected: ['a', 'b', 'c'], anchor: 'a' });
    expect(select(forward.selected, forward.anchor, 'b', order, { range: true }).selected).toEqual([
      'a',
      'b',
    ]);
    expect(select(['b'], 'b', 'folder', order, { range: true }).selected).toEqual([
      'folder',
      'a',
      'b',
    ]);
  });
  it('adds a range only when the additive modifier is held and falls back safely after navigation', () => {
    expect(
      select(['folder', 'b'], 'b', 'c', order, { range: true, toggle: true }).selected,
    ).toEqual(['folder', 'b', 'c']);
    expect(select(['old'], 'old', 'b', order, { range: true }).selected).toEqual(['b']);
  });
  it('preserves the current batch on context menu or drag, and selects an unselected target', () => {
    expect(select(['a', 'c'], 'a', 'c', order, { preserve: true })).toEqual({
      selected: ['a', 'c'],
      anchor: 'a',
    });
    expect(select(['a', 'c'], 'a', 'folder', order, { preserve: true })).toEqual({
      selected: ['folder'],
      anchor: 'folder',
    });
  });
});
