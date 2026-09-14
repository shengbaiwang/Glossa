import { describe, expect, it } from 'vitest';

import {
  createBookmark,
  extractBookmarkExcerpt,
  findBookmarksAtLocation,
  isCfiAtLocation,
} from '@/app/reader/utils/bookmark';
import { BookNote } from '@/types/book';

// A page whose visible range starts in the middle of the first paragraph and
// ends in the middle of the second one. The old bookmark code read
// `range.startContainer.textContent` here, which returns "First paragraph
// text." — the whole start node from its beginning — instead of the text the
// reader actually sees. The rebuilt extraction must respect the offsets.
const PAGE_HTML = '<p>First paragraph text.</p><p>Second paragraph continues here.</p>';

const makeMidPageRange = (): Range => {
  const host = document.createElement('div');
  host.innerHTML = PAGE_HTML;
  document.body.appendChild(host);
  const [first, second] = Array.from(host.querySelectorAll('p')).map((p) => p.firstChild);
  const range = document.createRange();
  range.setStart(first!, 6); // after "First "
  range.setEnd(second!, 6); // after "Second"
  return range;
};

const cleanupRanges = () => {
  document.body.innerHTML = '';
};

describe('extractBookmarkExcerpt', () => {
  it('extracts the actually visible text, respecting both range offsets', () => {
    const range = makeMidPageRange();
    try {
      expect(extractBookmarkExcerpt(range)).toBe('paragraph text.Second');
    } finally {
      cleanupRanges();
    }
  });

  it('does not return the whole start node like the old startContainer.textContent did', () => {
    const range = makeMidPageRange();
    try {
      const excerpt = extractBookmarkExcerpt(range);
      expect(excerpt.startsWith('First paragraph')).toBe(false);
      expect(excerpt.length).toBeLessThan('First paragraph text.'.length + 'Second'.length);
    } finally {
      cleanupRanges();
    }
  });

  it('collapses whitespace runs and newlines into single spaces', () => {
    const host = document.createElement('div');
    host.innerHTML = '<p>Spaced   out\ntext\t_here</p>';
    document.body.appendChild(host);
    const range = document.createRange();
    range.selectNodeContents(host.querySelector('p')!);
    try {
      expect(extractBookmarkExcerpt(range)).toBe('Spaced out text _here');
    } finally {
      cleanupRanges();
    }
  });

  it('truncates long excerpts with an ellipsis', () => {
    const host = document.createElement('div');
    host.innerHTML = `<p>${'a'.repeat(200)}</p>`;
    document.body.appendChild(host);
    const range = document.createRange();
    range.selectNodeContents(host.querySelector('p')!);
    try {
      const excerpt = extractBookmarkExcerpt(range, 128);
      expect(excerpt.length).toBe(129);
      expect(excerpt.endsWith('…')).toBe(true);
      expect(excerpt.startsWith('aaaaaaaaaa')).toBe(true);
    } finally {
      cleanupRanges();
    }
  });

  it('keeps an excerpt that is exactly at the limit untruncated', () => {
    const host = document.createElement('div');
    host.innerHTML = `<p>${'a'.repeat(128)}</p>`;
    document.body.appendChild(host);
    const range = document.createRange();
    range.selectNodeContents(host.querySelector('p')!);
    try {
      const excerpt = extractBookmarkExcerpt(range, 128);
      expect(excerpt.length).toBe(128);
      expect(excerpt.endsWith('…')).toBe(false);
    } finally {
      cleanupRanges();
    }
  });

  it('returns empty strings for missing or textless ranges', () => {
    expect(extractBookmarkExcerpt(null)).toBe('');
    expect(extractBookmarkExcerpt(undefined)).toBe('');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const range = document.createRange();
    range.selectNodeContents(host);
    try {
      expect(extractBookmarkExcerpt(range)).toBe('');
    } finally {
      cleanupRanges();
    }
  });
});

describe('isCfiAtLocation', () => {
  const location = 'epubcfi(/6/4!/4,/1:0,/1:400)';

  it('matches a bookmark that starts inside the visible range, bounds inclusive', () => {
    expect(isCfiAtLocation('epubcfi(/6/4!/4/1:30)', location)).toBe(true);
    expect(isCfiAtLocation('epubcfi(/6/4!/4/1:0)', location)).toBe(true);
    expect(isCfiAtLocation('epubcfi(/6/4!/4/1:400)', location)).toBe(true);
  });

  it('rejects bookmarks before, after, or in another section', () => {
    expect(isCfiAtLocation('epubcfi(/6/2!/4/1:50)', location)).toBe(false);
    expect(isCfiAtLocation('epubcfi(/6/4!/4/1:500)', location)).toBe(false);
    expect(isCfiAtLocation('epubcfi(/6/6!/4/1:50)', location)).toBe(false);
  });

  it('matches an identical location', () => {
    expect(isCfiAtLocation(location, location)).toBe(true);
  });

  it('does not repeat the old prefix-string false positive', () => {
    // The legacy matcher accepted `/6/4!/4/1:55` as "inside" the point
    // location `/6/4!/4/1:5` because the strings share a prefix. Only real
    // containment counts now.
    expect(isCfiAtLocation('epubcfi(/6/4!/4/1:55)', 'epubcfi(/6/4!/4/1:5)')).toBe(false);
    expect(isCfiAtLocation('epubcfi(/6/4!/4/1:5)', 'epubcfi(/6/4!/4/1:55)')).toBe(false);
  });

  it('treats a range bookmark as its start point', () => {
    expect(isCfiAtLocation('epubcfi(/6/4!/4,/1:0,/1:40)', location)).toBe(true);
    expect(isCfiAtLocation('epubcfi(/6/4!/4,/1:401,/1:500)', location)).toBe(false);
  });

  it('returns false instead of throwing on malformed or missing CFIs', () => {
    expect(isCfiAtLocation('', location)).toBe(false);
    expect(isCfiAtLocation('epubcfi(/6/4!/4/1:30)', '')).toBe(false);
    expect(isCfiAtLocation('epubcfi(/6/4!/4/1:30)', undefined)).toBe(false);
    expect(isCfiAtLocation('not a cfi', location)).toBe(false);
    expect(isCfiAtLocation('epubcfi(/6/4!/4/1:30', location)).toBe(false);
  });
});

describe('findBookmarksAtLocation', () => {
  const location = 'epubcfi(/6/4!/4,/1:0,/1:400)';
  const bookmark = (id: string, cfi: string): BookNote => ({
    id,
    type: 'bookmark',
    cfi,
    note: '',
    createdAt: 0,
    updatedAt: 0,
  });

  it('returns every bookmark whose start lies inside the location, in input order', () => {
    const bookmarks = [
      bookmark('before', 'epubcfi(/6/2!/4/1:0)'),
      bookmark('second', 'epubcfi(/6/4!/4/1:80)'),
      bookmark('first', 'epubcfi(/6/4!/4/1:10)'),
      bookmark('elsewhere', 'epubcfi(/6/6!/4/1:0)'),
    ];
    const matches = findBookmarksAtLocation(bookmarks, location);
    expect(matches.map((m) => m.id)).toEqual(['second', 'first']);
  });

  it('skips entries without a usable cfi instead of throwing', () => {
    const bookmarks = [bookmark('broken', ''), bookmark('ok', 'epubcfi(/6/4!/4/1:10)')];
    expect(findBookmarksAtLocation(bookmarks, location).map((m) => m.id)).toEqual(['ok']);
  });

  it('returns nothing without a location', () => {
    expect(findBookmarksAtLocation([bookmark('a', 'epubcfi(/6/4!/4/1:10)')], null)).toEqual([]);
    expect(findBookmarksAtLocation([], location)).toEqual([]);
  });

  it('matches the same set as isCfiAtLocation for each entry', () => {
    const cfis = ['epubcfi(/6/4!/4/1:30)', 'epubcfi(/6/4!/4/1:500)', 'epubcfi(/6/4!/4,/1:0,/1:40)'];
    const matched = new Set(
      findBookmarksAtLocation(
        cfis.map((c, i) => bookmark(`b${i}`, c)),
        location,
      ).map((m) => m.id),
    );
    for (const [i, cfi] of cfis.entries()) {
      expect(matched.has(`b${i}`)).toBe(isCfiAtLocation(cfi, location));
    }
  });
});

describe('createBookmark', () => {
  it('builds a live bookmark record with the given anchor, excerpt and page', () => {
    const now = 1_700_000_000_000;
    const note = createBookmark({
      cfi: 'epubcfi(/6/4!/4,/1:0,/1:400)',
      text: 'Page text',
      page: 12,
      now,
    });
    expect(note).toMatchObject({
      type: 'bookmark',
      cfi: 'epubcfi(/6/4!/4,/1:0,/1:400)',
      text: 'Page text',
      page: 12,
      note: '',
      createdAt: now,
      updatedAt: now,
    });
    expect(note.id.length).toBeGreaterThan(0);
  });
});
