import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import {
  Contents,
  Bookmarks,
  Citation,
  BookmarkPlus,
  Pencil,
  CloudUpload,
  Lock,
  Palette,
} from '@/components/GlossaIcons';

afterEach(cleanup);

it('keeps navigation, editing, settings and sync glyphs on the same accessible drawing contract', () => {
  for (const [name, Glyph] of Object.entries({
    Contents,
    Bookmarks,
    Citation,
    BookmarkPlus,
    Pencil,
    CloudUpload,
    Lock,
    Palette,
  })) {
    const { container, unmount } = render(
      <Glyph size={18} className='role-fixture' aria-hidden={false} aria-label={name} />,
    );
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg.getAttribute('stroke-width')).toBe('1.8');
    expect(svg.getAttribute('stroke-linecap')).toBe('round');
    expect(svg.getAttribute('stroke-linejoin')).toBe('round');
    expect(svg.getAttribute('width')).toBe('18');
    expect(svg.classList.contains('glossa-icon')).toBe(true);
    expect(svg.classList.contains('role-fixture')).toBe(true);
    expect(svg.getAttribute('aria-label')).toBe(name);
    expect(svg.getAttribute('aria-hidden')).toBe('false');
    unmount();
  }
});
