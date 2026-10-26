import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { BookMetadata } from '@/libs/document';
import { useMetadataEdit } from '@/components/metadata/useMetadataEdit';

const metadata = { title: 'Book', author: 'Author' } as BookMetadata;
// Stable references: the hook resyncs on the tags identity, like the modal's
// state-held tags array.
const oldTags = ['old'];
const noTags: string[] = [];
const keptTags = ['kept'];

// Tags edit through the standard field pipeline: a
// comma-separated string that splits into the tag list and honors the
// per-field lock.
describe('useMetadataEdit tags field', () => {
  it('splits a comma-separated tags field into the tag list', () => {
    const { result } = renderHook(() => useMetadataEdit(metadata, oldTags));

    act(() => {
      result.current.handleFieldChange('tags', 'Favorites, To Read; 科幻');
    });

    expect(result.current.editedTags).toEqual(['Favorites', 'To Read', '科幻']);
    expect(result.current.editedMeta).not.toHaveProperty('tags');
  });

  it('keeps the trailing empty segment so a typed separator survives the round-trip', () => {
    const { result } = renderHook(() => useMetadataEdit(metadata, noTags));

    act(() => {
      result.current.handleFieldChange('tags', 'Favorites,');
    });

    expect(result.current.editedTags.join(', ')).toBe('Favorites, ');
  });

  it('ignores tag edits while the tags field is locked', () => {
    const { result } = renderHook(() => useMetadataEdit(metadata, keptTags));

    act(() => {
      result.current.handleToggleFieldLock('tags');
    });
    act(() => {
      result.current.handleFieldChange('tags', 'other');
    });

    expect(result.current.editedTags).toEqual(['kept']);
  });
});

it('drops legacy subject fields from edit, reset, and source selection without creating tags', () => {
  const legacy = { ...metadata, subject: ['History'], subjects: ['Legacy'] };
  const { result } = renderHook(() => useMetadataEdit(legacy, keptTags));
  expect(result.current.editedMeta).not.toHaveProperty('subject');
  expect(result.current.editedMeta).not.toHaveProperty('subjects');
  act(() => {
    result.current.handleFieldChange('subject', 'Other');
    result.current.handleSourceSelection({
      sourceName: 'test',
      sourceLabel: 'Test',
      confidence: 1,
      data: legacy,
    });
  });
  expect(result.current.editedMeta).not.toHaveProperty('subject');
  expect(result.current.editedMeta).not.toHaveProperty('subjects');
  expect(result.current.editedTags).toEqual(keptTags);
  act(() => result.current.resetToOriginal());
  expect(result.current.editedMeta).not.toHaveProperty('subject');
  expect(result.current.editedMeta).not.toHaveProperty('subjects');
});
