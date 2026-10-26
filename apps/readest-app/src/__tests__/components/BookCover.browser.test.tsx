import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import BookCover from '@/components/BookCover';
import GroupItem from '@/app/library/components/GroupItem';
import BookItem from '@/app/library/components/BookItem';
import type { Book } from '@/types/book';
import type { LibraryCoverFitType } from '@/types/settings';
import '@/styles/globals.css';
import '@/styles/glossa.css';
import '@/styles/glossa-library.css';

const mocks = vi.hoisted(() => ({ paper: true, open: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({}) }));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: {} }) }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, values?: Record<string, unknown>) =>
    key.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values?.[name] ?? `{{${name}}}`)),
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({ settings: { librarySkeuomorphicCovers: mocks.paper } }),
}));
vi.mock('@/hooks/useMedianPageDurationSecs', () => ({
  useMedianPageDurationSecs: () => undefined,
}));

function cover(width: number, height: number, fill = '#e0d5bd', title = 'FIELD NOTES') {
  return `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 300 440" preserveAspectRatio="none"><rect width="300" height="440" fill="${fill}"/><path d="M38 100H262M38 326H262" stroke="#494636" stroke-opacity=".35"/><circle cx="150" cy="235" r="60" fill="none" stroke="#494636" stroke-opacity=".25"/><text x="38" y="72" fill="#292c26" font-family="Georgia,serif" font-size="26">${title}</text><text x="38" y="365" fill="#494636" font-family="Georgia,serif" font-size="13">ESSAYS ON READING</text><text x="38" y="391" fill="#494636" font-family="Georgia,serif" font-size="11">GLOSSA EDITIONS</text></svg>`,
  )}`;
}

const book: Book = {
  hash: 'paper-book',
  title: 'Field Notes',
  author: '林青',
  format: 'EPUB',
  createdAt: 1,
  updatedAt: 1,
  progress: [23, 100],
  coverImageUrl: cover(600, 900),
};

function Gallery({
  selecting = false,
  selected = false,
  fit = 'crop',
  mixed = false,
}: {
  selecting?: boolean;
  selected?: boolean;
  fit?: LibraryCoverFitType;
  mixed?: boolean;
}) {
  const books = [
    book,
    {
      ...book,
      hash: 'red',
      title: '红色档案',
      coverImageUrl: cover(mixed ? 360 : 600, 900, '#a64d3e', 'ARCHIVE'),
    },
    {
      ...book,
      hash: 'dark',
      title: '林间札记',
      coverImageUrl: cover(mixed ? 900 : 600, mixed ? 600 : 900, '#788477', 'FOREST'),
    },
    { ...book, hash: 'plain', title: '纸上行旅：关于阅读与记忆', coverImageUrl: undefined },
  ];
  return (
    <main style={{ padding: 32 }}>
      <button type='button' aria-label='Outside' style={{ marginBottom: 24 }}>
        Glossa
      </button>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, 180px)', gap: 20 }}>
        {books.map((item) => (
          <div
            key={item.hash}
            className={`glossa-book-card glossa-book-card-grid${selected ? ' glossa-book-card-selected' : ''}`}
            role='button'
            tabIndex={0}
            aria-label={`Open ${item.title}`}
            onClickCapture={mocks.open}
          >
            <BookItem
              book={item}
              mode='grid'
              coverFit={fit}
              isSelectMode={selecting}
              bookSelected={selected}
              transferProgress={null}
              handleBookUpload={vi.fn()}
              handleBookDownload={vi.fn()}
              showBookDetailsModal={vi.fn()}
              showTimeRemaining={false}
            />
          </div>
        ))}
      </div>
    </main>
  );
}

function firstSurface() {
  return document.querySelector<HTMLElement>('.book-cover-surface')!;
}

function lift() {
  return new DOMMatrixReadOnly(getComputedStyle(firstSurface()).transform).m42;
}

async function loadedImages() {
  await waitFor(() => {
    for (const image of document.querySelectorAll<HTMLImageElement>('img.cover-image')) {
      expect(image.naturalWidth).toBeGreaterThan(0);
      expect(getComputedStyle(image).visibility).toBe('visible');
    }
  });
}

afterEach(() => {
  cleanup();
  mocks.paper = true;
  mocks.open.mockReset();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-eink');
  document.documentElement.removeAttribute('data-page');
  document.documentElement.removeAttribute('dir');
  document.body.classList.remove('bg-base-100', 'text-base-content');
});

it.each([
  ['fit', 360, 900],
  ['fit', 900, 600],
  ['crop', 600, 900],
] as const)('keeps the %s face, binding and shadow within the actual %i × %i image', async (fit, width, height) => {
  render(
    <div style={{ width: 200, height: 292 }}>
      <BookCover book={{ ...book, coverImageUrl: cover(width, height) }} coverFit={fit} showSpine />
    </div>,
  );
  await loadedImages();
  const face = firstSurface().getBoundingClientRect();
  const root = document.querySelector('.book-cover-container')!.getBoundingClientRect();
  const image = document.querySelector('img')!.getBoundingClientRect();
  const spine = document.querySelector('.book-spine')!.getBoundingClientRect();
  expect(face.width).toBeGreaterThan(0);
  expect(face.right).toBeLessThan(root.right);
  expect(face.bottom).toBeLessThan(root.bottom);
  expect(image.width).toBeCloseTo(face.width, 1);
  expect(image.height).toBeCloseTo(face.height, 1);
  expect(spine.height).toBeCloseTo(face.height, 1);
  expect(spine.width).toBeLessThan(face.width * 0.11);
  if (fit === 'fit') expect(face.width / face.height).toBeCloseTo(width / height, 2);
});

it.each([
  'default-light',
  'default-dark',
])('renders quiet paper, clean artwork and a composed fallback in %s', async (theme) => {
  await page.viewport(940, 600);
  document.documentElement.setAttribute('data-page', 'library');
  document.documentElement.setAttribute('data-theme', theme);
  document.body.classList.add('bg-base-100', 'text-base-content');
  render(<Gallery />);
  await loadedImages();
  expect(getComputedStyle(firstSurface()).boxShadow).not.toBe('none');
  const face = document.querySelector('.book-cover-face')!;
  expect(getComputedStyle(face, '::after').backgroundImage).toBe('none');
  expect(getComputedStyle(firstSurface(), '::before').backgroundImage).toContain(
    'repeating-linear-gradient',
  );
  const fallback = document.querySelector<HTMLElement>(
    '[data-material="paper"] .fallback-cover:not(.invisible)',
  )!;
  expect(getComputedStyle(fallback).visibility).toBe('visible');
  expect(fallback.textContent).toContain('纸上行旅');
  await page.getByRole('button', { name: 'Outside', exact: true }).hover();
  const mode = matchMedia('(prefers-reduced-motion: reduce)').matches
    ? '-reduced'
    : matchMedia('(pointer: coarse)').matches
      ? '-touch'
      : '';
  await page.screenshot({ path: `../../../../../.glossa-dev/qa/covers-${theme}${mode}.png` });
});

it('lifts only the book, settles on exit and preserves the reading hit target', async () => {
  render(<Gallery />);
  await loadedImages();
  const title = document.querySelector('.glossa-book-title')!;
  const titleTop = title.getBoundingClientRect().top;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hover = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const card = page.getByRole('button', { name: 'Open Field Notes', exact: true });
  await card.hover();
  await expect.poll(lift).toBeCloseTo(hover && !reduced ? -2 : 0, 1);
  expect(title.getBoundingClientRect().top).toBe(titleTop);
  let pressDuration = '';
  document.querySelector('.glossa-book-card')!.addEventListener(
    'pointerdown',
    () => {
      pressDuration = getComputedStyle(firstSurface()).transitionDuration;
    },
    { once: true },
  );
  await card.click();
  expect(mocks.open).toHaveBeenCalledOnce();
  if (hover && !reduced) expect(pressDuration).toBe('0.09s');
  await page.getByRole('button', { name: 'Outside', exact: true }).click();
  await expect.poll(lift).toBeCloseTo(0, 1);
  if (reduced) expect(getComputedStyle(firstSurface()).transitionDuration).toBe('0s');
});

it('provides a keyboard lift and leaves child controls and selection still', async () => {
  const { rerender } = render(<Gallery />);
  await loadedImages();
  await page.getByRole('button', { name: 'Outside', exact: true }).click();
  await userEvent.keyboard('{Tab}');
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Open Field Notes');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  await expect.poll(lift).toBeCloseTo(reduced ? 0 : -2, 1);
  await userEvent.keyboard('{Tab}');
  await expect.poll(lift).toBeCloseTo(0, 1);
  rerender(<Gallery selecting selected />);
  await page.getByRole('button', { name: 'Open Field Notes', exact: true }).hover();
  await expect.poll(lift).toBeCloseTo(0, 1);
});

it('keeps RTL binding and paper edges on opposite sides', async () => {
  document.documentElement.dir = 'rtl';
  render(
    <div style={{ width: 160, height: 240 }}>
      <BookCover book={book} showSpine />
    </div>,
  );
  await loadedImages();
  const face = firstSurface().getBoundingClientRect();
  const spine = document.querySelector('.book-spine')!.getBoundingClientRect();
  expect(spine.right).toBeCloseTo(face.right, 1);
  expect(parseFloat(getComputedStyle(firstSurface(), '::before').left)).toBeLessThan(0);
});

it.each([
  [76, 'ltr'],
  [180, 'ltr'],
  [76, 'rtl'],
  [180, 'rtl'],
] as const)('joins the binding foot to a rounded page edge at %ipx in %s', async (width, direction) => {
  document.documentElement.dir = direction;
  render(
    <div style={{ width, height: width * 1.46 }}>
      <BookCover book={book} showSpine />
    </div>,
  );
  await loadedImages();
  const pages = getComputedStyle(firstSurface(), '::before');
  const depth = -parseFloat(pages.bottom);
  // A rounded heel starts under the binding, rather than exposing an offset square tab.
  expect(parseFloat(pages.insetInlineStart)).toBeLessThanOrEqual(1.5);
  expect(parseFloat(pages.borderEndStartRadius)).toBeGreaterThan(depth + 1);
  expect(pages.boxShadow === 'none' || pages.boxShadow.includes('inset')).toBe(true);
});

it.each([
  'default-light',
  'default-dark',
])('previews binding corners at normal size and 4× in %s', async (theme) => {
  await page.viewport(940, 600);
  document.documentElement.setAttribute('data-theme', theme);
  document.body.classList.add('bg-base-100', 'text-base-content');
  const colors = ['#e0d5bd', '#a64d3e', '#788477'];
  render(
    <main style={{ padding: 32 }}>
      <h1 style={{ marginBottom: 24 }}>Glossa · 装订转角</h1>
      <div style={{ display: 'flex', gap: 48 }}>
        {colors.map((color) => (
          <div key={color}>
            <div style={{ width: 180, height: 264 }}>
              <BookCover book={{ ...book, coverImageUrl: cover(600, 900, color) }} showSpine />
            </div>
            <div
              style={{
                position: 'relative',
                width: 180,
                height: 128,
                overflow: 'hidden',
                marginTop: 24,
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  width: 180,
                  height: 264,
                  bottom: 16,
                  left: 16,
                  transform: 'scale(4)',
                  transformOrigin: 'bottom left',
                }}
              >
                <BookCover book={{ ...book, coverImageUrl: cover(600, 900, color) }} showSpine />
              </div>
            </div>
            <p style={{ fontSize: 12, opacity: 0.6 }}>左下角 · 4×</p>
          </div>
        ))}
        <div style={{ width: 120, display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div style={{ width: 76, height: 112 }}>
            <BookCover book={book} showSpine />
          </div>
          <div dir='rtl' style={{ width: 76, height: 112 }}>
            <BookCover book={book} showSpine />
          </div>
          <div style={{ width: 28, height: 41 }}>
            <BookCover book={book} isPreview showSpine />
          </div>
          <p style={{ fontSize: 12, opacity: 0.6 }}>小封面 / RTL</p>
        </div>
      </div>
    </main>,
  );
  await loadedImages();
  await page.screenshot({ path: `../../../../../.glossa-dev/qa/covers-binding-${theme}.png` });
});

it('keeps the editable metadata preview free of an outer clipping frame', async () => {
  render(
    <button
      type='button'
      aria-label='Change cover image'
      className='glossa-metadata-cover-preview'
      style={{ width: 160 }}
    >
      <BookCover book={book} mode='list' showSpine />
    </button>,
  );
  await loadedImages();
  const preview = document.querySelector('.glossa-metadata-cover-preview')!;
  expect(getComputedStyle(preview).overflow).toBe('visible');
  expect(getComputedStyle(preview).borderTopWidth).toBe('0px');
});

it('keeps page-edge lines behind an opaque paper face when artwork is transparent', async () => {
  const transparentCover = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><circle cx="300" cy="450" r="100" fill="#788477"/></svg>')}`;
  render(
    <div style={{ width: 160, height: 240 }}>
      <BookCover book={{ ...book, coverImageUrl: transparentCover }} showSpine />
    </div>,
  );
  await loadedImages();
  expect(getComputedStyle(document.querySelector('.book-cover-face')!).backgroundColor).not.toBe(
    'rgba(0, 0, 0, 0)',
  );
});

it('keeps mixed natural cover ratios and title baselines stable in the real book grid', async () => {
  await page.viewport(940, 600);
  document.documentElement.setAttribute('data-theme', 'default-light');
  document.body.classList.add('bg-base-100', 'text-base-content');
  render(<Gallery fit='fit' mixed />);
  const titleTops = [...document.querySelectorAll('.glossa-book-title')].map(
    (title) => title.getBoundingClientRect().top,
  );
  await loadedImages();
  const faces = [...document.querySelectorAll('.book-cover-surface')].map((face) =>
    face.getBoundingClientRect(),
  );
  expect(faces[1]!.width / faces[1]!.height).toBeCloseTo(0.4, 2);
  expect(faces[2]!.width / faces[2]!.height).toBeCloseTo(1.5, 2);
  for (const [index, title] of [...document.querySelectorAll('.glossa-book-title')].entries()) {
    expect(title.getBoundingClientRect().top).toBeCloseTo(titleTops[index]!, 1);
  }
  expect(Math.max(...titleTops) - Math.min(...titleTops)).toBeLessThan(1);
  await page.getByRole('button', { name: 'Outside', exact: true }).hover();
  await page.screenshot({ path: '../../../../../.glossa-dev/qa/covers-natural-ratios.png' });
});

it('uses static crisp boundaries in e-ink and respects the existing flat-cover switch', async () => {
  document.documentElement.setAttribute('data-eink', 'true');
  const { rerender } = render(<Gallery fit='fit' />);
  await loadedImages();
  await page.getByRole('button', { name: 'Open Field Notes', exact: true }).hover();
  expect(lift()).toBe(0);
  expect(getComputedStyle(firstSurface()).boxShadow).toBe('none');
  expect(getComputedStyle(firstSurface()).transitionDuration).toBe('0s');
  expect(getComputedStyle(firstSurface(), '::before').display).toBe('none');
  expect(getComputedStyle(document.querySelector('.book-spine')!).display).toBe('none');
  document.documentElement.removeAttribute('data-eink');
  mocks.paper = false;
  rerender(<Gallery />);
  expect(document.querySelector('.book-spine')).toBeNull();
  expect(getComputedStyle(firstSurface(), '::before').content).toBe('none');
  await page.getByRole('button', { name: 'Open Field Notes', exact: true }).hover();
  await expect.poll(lift).toBeCloseTo(0, 1);
});

it('fits small list covers and narrow shelves without clipping or horizontal overflow', async () => {
  await page.viewport(320, 650);
  document.documentElement.setAttribute('data-page', 'library');
  render(<Gallery fit='fit' />);
  await loadedImages();
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(320);
  cleanup();
  render(
    <div style={{ width: 76, height: 112 }}>
      <BookCover book={book} mode='list' coverFit='fit' showSpine />
    </div>,
  );
  await loadedImages();
  const face = firstSurface().getBoundingClientRect();
  expect(face.width).toBeLessThanOrEqual(74);
  expect(face.height).toBeLessThanOrEqual(110);
  expect(getComputedStyle(firstSurface(), '::before').pointerEvents).toBe('none');
});

it('centers original book and group artwork within identical grid stages', async () => {
  await page.viewport(1000, 700);
  document.documentElement.setAttribute('data-theme', 'default-light');
  document.body.classList.add('bg-base-100', 'text-base-content');
  const narrow = {
    ...book,
    hash: 'narrow-unified',
    title: '山川札记',
    coverImageUrl: cover(400, 1000),
  };
  const wide = {
    ...book,
    hash: 'wide-unified',
    title: '海上来信',
    coverImageUrl: cover(1000, 600, '#b1bdc6'),
  };
  const group = {
    id: 'notes',
    name: 'Notes',
    displayName: '山川与海上来信',
    books: [narrow, wide],
    updatedAt: 1,
  };
  const { container } = render(
    <div
      className='glossa-collection-grid'
      style={{ display: 'grid', gridTemplateColumns: '180px 180px 180px', padding: 20 }}
    >
      <BookItem
        book={narrow}
        mode='grid'
        coverFit='fit'
        isSelectMode={false}
        bookSelected={false}
        transferProgress={null}
        handleBookUpload={vi.fn()}
        handleBookDownload={vi.fn()}
        showBookDetailsModal={vi.fn()}
        showTimeRemaining={false}
      />
      <GroupItem group={group} mode='grid' isSelectMode={false} groupSelected={false} />
      <BookItem
        book={wide}
        mode='grid'
        coverFit='fit'
        isSelectMode={false}
        bookSelected={false}
        transferProgress={null}
        handleBookUpload={vi.fn()}
        handleBookDownload={vi.fn()}
        showBookDetailsModal={vi.fn()}
        showTimeRemaining={false}
      />
    </div>,
  );
  await waitFor(() =>
    expect(
      [...container.querySelectorAll<HTMLImageElement>('img')].every(
        (img) => img.complete && img.naturalWidth > 0 && !img.classList.contains('invisible'),
      ),
    ).toBe(true),
  );
  for (const item of container.querySelectorAll('.library-grid-item')) {
    const stage = item.querySelector('.glossa-book-cover-stage')!.getBoundingClientRect();
    const face = item.querySelector('.book-cover-surface')!.getBoundingClientRect();
    expect(Math.abs(face.x + face.width / 2 - stage.x - stage.width / 2)).toBeLessThanOrEqual(5);
  }
  const groupFaces = [...container.querySelectorAll('.group-item .book-cover-surface')].map(
    (face) => face.getBoundingClientRect(),
  );
  expect(
    Math.max(...groupFaces.map((face) => face.right)) -
      Math.min(...groupFaces.map((face) => face.left)),
  ).toBeLessThanOrEqual(groupFaces[0]!.width + 8);
  await page.screenshot({ path: '../../../../../.glossa-dev/qa/unified-cards-light.png' });
  document.documentElement.setAttribute('data-theme', 'default-dark');
  await page.screenshot({ path: '../../../../../.glossa-dev/qa/unified-cards-dark.png' });
});
