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

const mocks = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({}) }));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: {} }) }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, values?: Record<string, unknown>) =>
    key.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values?.[name] ?? `{{${name}}}`)),
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({ settings: {} }),
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
  selected = false,
  fit = 'crop',
  mixed = false,
}: {
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
] as const)('keeps the flat %s face within the actual %i × %i image', async (fit, width, height) => {
  render(
    <div style={{ width: 200, height: 292 }}>
      <BookCover book={{ ...book, coverImageUrl: cover(width, height) }} coverFit={fit} />
    </div>,
  );
  await loadedImages();
  const face = firstSurface().getBoundingClientRect();
  const root = document.querySelector('.book-cover-container')!.getBoundingClientRect();
  const image = document.querySelector('img')!.getBoundingClientRect();
  expect(face.width).toBeGreaterThan(0);
  expect(face.right).toBeLessThanOrEqual(root.right + 0.1);
  expect(face.bottom).toBeLessThanOrEqual(root.bottom + 0.1);
  expect(image.width).toBeCloseTo(face.width, 1);
  expect(image.height).toBeCloseTo(face.height, 1);
  expect(document.querySelector('.book-spine')).toBeNull();
  expect(getComputedStyle(firstSurface(), '::before').content).toBe('none');
  if (fit === 'fit') expect(face.width / face.height).toBeCloseTo(width / height, 2);
  else {
    expect(face.width).toBeCloseTo(root.width, 1);
    expect(face.height).toBeCloseTo(root.height, 1);
  }
});

it.each([
  'default-light',
  'default-dark',
])('renders flat artwork and a composed fallback in %s', async (theme) => {
  await page.viewport(940, 600);
  document.documentElement.setAttribute('data-page', 'library');
  document.documentElement.setAttribute('data-theme', theme);
  document.body.classList.add('bg-base-100', 'text-base-content');
  render(<Gallery />);
  await loadedImages();
  expect(getComputedStyle(firstSurface()).boxShadow).toBe('none');
  expect(getComputedStyle(firstSurface(), '::before').content).toBe('none');
  const fallback = document.querySelector<HTMLElement>('.fallback-cover:not(.invisible)')!;
  expect(getComputedStyle(fallback).visibility).toBe('visible');
  expect(fallback.textContent).toContain('纸上行旅');
  await page.screenshot({ path: `../../../../../.glossa-dev/qa/flat-covers-${theme}.png` });
});

it('keeps flat covers, title baselines and the reading hit target still during hover and keyboard focus', async () => {
  render(<Gallery />);
  await loadedImages();
  const title = document.querySelector('.glossa-book-title')!;
  const titleTop = title.getBoundingClientRect().top;
  const card = page.getByRole('button', { name: 'Open Field Notes', exact: true });
  await card.hover();
  expect(lift()).toBe(0);
  expect(title.getBoundingClientRect().top).toBe(titleTop);
  await card.click();
  expect(mocks.open).toHaveBeenCalledOnce();
  await page.getByRole('button', { name: 'Outside', exact: true }).click();
  await userEvent.keyboard('{Tab}');
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Open Field Notes');
  expect(lift()).toBe(0);
});

it('keeps transparent artwork over an opaque paper face', async () => {
  const transparentCover = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><circle cx="300" cy="450" r="100" fill="#788477"/></svg>')}`;
  render(
    <div style={{ width: 160, height: 240 }}>
      <BookCover book={{ ...book, coverImageUrl: transparentCover }} />
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
  await page.screenshot({ path: '../../../../../.glossa-dev/qa/flat-covers-natural-ratios.png' });
});

it('uses static crisp boundaries in e-ink and RTL', async () => {
  document.documentElement.setAttribute('data-eink', 'true');
  document.documentElement.dir = 'rtl';
  render(<Gallery fit='fit' />);
  await loadedImages();
  await page.getByRole('button', { name: 'Open Field Notes', exact: true }).hover();
  expect(lift()).toBe(0);
  expect(getComputedStyle(firstSurface()).boxShadow).toBe('none');
  expect(getComputedStyle(firstSurface()).transitionDuration).toBe('0s');
  expect(document.querySelector('.book-spine')).toBeNull();
  expect(getComputedStyle(firstSurface(), '::before').content).toBe('none');
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
      <BookCover book={book} mode='list' coverFit='fit' />
    </div>,
  );
  await loadedImages();
  const face = firstSurface().getBoundingClientRect();
  expect(face.width).toBeLessThanOrEqual(76);
  expect(face.height).toBeLessThanOrEqual(112);
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
        bookSelected={false}
        transferProgress={null}
        handleBookUpload={vi.fn()}
        handleBookDownload={vi.fn()}
        showBookDetailsModal={vi.fn()}
        showTimeRemaining={false}
      />
      <GroupItem group={group} mode='grid' groupSelected={false} />
      <BookItem
        book={wide}
        mode='grid'
        coverFit='fit'
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
