import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import type { Book } from '@/types/book';
import type { BookDoc } from '@/libs/document';
import type { ReadingMindmap } from '@/glossa/mindmap/types';
import { getMindmapIdentity } from '@/glossa/mindmap/identity';
import { getPassageId } from '@/glossa/passages/passages';
import { createMapFromMindmap, editTree } from '@/glossa/mindmap/workspace';
import { saveMapWorkspace, loadMapWorkspace } from '@/glossa/mindmap/workspaceStore';
import { exportMapSvg } from '@/glossa/mindmap/export';
import { navigateSource } from '@/glossa/citations/navigation';
import MindmapPanel from '@/glossa/ui/MindmapPanel';
import '@/styles/globals.css';
import '@/styles/glossa.css';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, values?: Record<string, string>) =>
    key.replace(/{{(\w+)}}/g, (_, name: string) => values?.[name] ?? name),
}));
vi.mock('@/glossa/citations/sources', () => ({
  resolveSource: async (_doc: unknown, source: { text: string }) => ({
    text: source.text,
    cfi: 'verified',
  }),
}));
vi.mock('@/glossa/citations/navigation', () => ({ navigateSource: vi.fn() }));
vi.mock('@/glossa/citations/highlight', () => ({ highlightSource: () => vi.fn() }));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: { getState: () => ({ getView: () => ({ lastLocation: { cfi: 'origin' } }) }) },
}));
afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-eink');
  document.documentElement.removeAttribute('dir');
});

async function mount() {
  const book = { hash: crypto.randomUUID(), title: '原创观点样本' } as Book;
  const text = '推论仅在观察满足条件时适用。一次观察不能支持无限推广。';
  const sources: ReadingMindmap['sources'] = [
    {
      sourceId: 's1',
      text,
      kind: 'paragraph',
      anchor: {
        sectionIndex: 0,
        cfi: 'epubcfi(/6/2!/4/2)',
        quote: { exact: text, prefix: '', suffix: '' },
      },
    },
  ];
  const provider = {
    id: 'fixture',
    name: 'Fixture',
    baseUrl: 'https://example.test/v1',
    model: 'fixture',
  };
  const passageId = getPassageId('chapter', sources);
  const origin: ReadingMindmap = {
    id: crypto.randomUUID(),
    bookId: book.hash,
    chapterId: 'chapter',
    passageId,
    createdAt: new Date().toISOString(),
    promptVersion: 'mindmap-3',
    schemaVersion: 1,
    provider,
    sources,
    insufficientEvidence: false,
    ...(await getMindmapIdentity(book.hash, passageId, sources, provider)),
    nodes: [
      {
        id: 'root',
        parentId: null,
        label: '推论的适用范围受到条件限制',
        relation: '',
        explanation: '不能忽略推论的适用条件。',
        sourceIds: ['s1'],
        kind: 'source',
      },
      {
        id: 'condition',
        parentId: 'root',
        label: '观察满足原先设定的条件',
        relation: '前提是',
        explanation: '先核对观察是否满足条件，再判断推论能否用于当前情形。',
        sourceIds: ['s1'],
        kind: 'source',
      },
      {
        id: 'scope',
        parentId: 'root',
        label: '一次观察不能支持无限推广',
        relation: '',
        explanation: '单次例子的范围有限。',
        sourceIds: ['s1'],
        kind: 'source',
      },
    ],
  };
  const map = createMapFromMindmap(origin);
  map.view = 'map';
  map.nodes = editTree(map.nodes, {
    type: 'add',
    id: 'manual',
    parentId: 'root',
    label: '我的待核对想法',
  });
  await saveMapWorkspace({
    version: 1,
    bookId: book.hash,
    revision: 0,
    activeId: map.id,
    maps: [map],
  });
  const mounted = render(
    <div data-testid='sidebar' style={{ width: 420, height: 850 }}>
      <MindmapPanel book={book} bookDoc={{} as BookDoc} bookKey={book.hash} />
    </div>,
  );
  await screen.findByRole('button', { name: origin.nodes[1]!.label });
  return { book, origin, mounted };
}

it('keeps labels standalone, puts the selected relationship between nodes and preserves original explanations through editing', async () => {
  await page.viewport(1280, 1000);
  const { book, origin, mounted } = await mount();
  expect(document.querySelector('.glossa-workmap-edge')).toBeNull();
  expect(screen.queryByRole('complementary', { name: 'Generated explanation' })).toBeNull();
  expect(
    document.querySelector('.glossa-workmap-label small:not(.glossa-workmap-count)'),
  ).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: origin.nodes[1]!.label }));
  await screen.findByText(origin.nodes[1]!.explanation);
  expect(screen.queryByRole('complementary', { name: 'Source excerpt' })).toBeNull();
  await waitFor(() => expect(navigateSource).toHaveBeenCalled());
  const edge = document.querySelector('.glossa-workmap-edge')!;
  expect(edge.textContent).toBe('前提是');
  const child = screen
    .getByRole('button', { name: origin.nodes[1]!.label })
    .closest('.glossa-workmap-node')!;
  for (const rtl of [false, true]) {
    document.documentElement.setAttribute('dir', rtl ? 'rtl' : 'ltr');
    const a = edge.getBoundingClientRect(),
      b = child.getBoundingClientRect();
    expect(rtl ? a.left >= b.right : a.right <= b.left).toBe(true);
    expect(a.top >= b.top && a.bottom <= b.bottom).toBe(true);
  }
  document.documentElement.setAttribute('dir', 'ltr');
  document.documentElement.setAttribute('data-theme', 'default-dark');
  fireEvent.click(screen.getByRole('button', { name: 'Expand workspace' }));
  await waitFor(() => expect(document.querySelector('dialog')?.matches(':modal')).toBe(true));
  await page.screenshot({ path: '../../../../../.glossa-dev/qa/map-presentation-dark.png' });
  fireEvent.click(screen.getByRole('button', { name: 'Close expanded view' }));
  fireEvent.click(screen.getByRole('button', { name: 'Edit idea' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Idea text' }), {
    target: { value: '我的修订观点' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  expect(screen.getByText(`Original idea: ${origin.nodes[1]!.label}`)).toBeTruthy();
  expect(screen.getByText(origin.nodes[1]!.explanation)).toBeTruthy();
  await waitFor(() => expect(screen.getByText('Saved on this device')).toBeTruthy());
  const saved = await loadMapWorkspace(book.hash);
  expect(saved.maps[0]!.origin).toEqual(origin);
  const svg = new DOMParser().parseFromString(exportMapSvg(saved.maps[0]!), 'image/svg+xml');
  const edgeText = Array.from(svg.querySelectorAll('text')).find(
    (el) => el.textContent === '前提是',
  )!;
  const labelText = Array.from(svg.querySelectorAll('text')).find(
    (el) => el.textContent === '我的修订观点',
  )!;
  expect(Number(edgeText.getAttribute('x'))).toBeLessThan(Number(labelText.getAttribute('x')));
  fireEvent.click(screen.getByRole('button', { name: origin.nodes[2]!.label }));
  expect(document.querySelector('.glossa-workmap-edge')).toBeNull();
  expect(screen.queryByText(origin.nodes[1]!.explanation)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '我的待核对想法' }));
  expect(screen.queryByRole('complementary', { name: 'Generated explanation' })).toBeNull();
  mounted.unmount();
});

it('keeps explanations and the canvas inside a narrow e-ink workspace', async () => {
  const { origin } = await mount();
  screen.getByTestId('sidebar').style.width = '320px';
  document.documentElement.setAttribute('dir', 'rtl');
  document.documentElement.setAttribute('data-eink', 'true');
  fireEvent.click(screen.getByRole('button', { name: origin.nodes[1]!.label }));
  await screen.findByText(origin.nodes[1]!.explanation);
  const dialog = document.querySelector('dialog')!.getBoundingClientRect();
  const details = screen
    .getByRole('complementary', { name: 'Generated explanation' })
    .getBoundingClientRect();
  expect(dialog.width).toBeLessThanOrEqual(320);
  expect(details.left >= dialog.left && details.right <= dialog.right).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Outline view' }));
  expect(document.querySelector('.glossa-workmap-edge')).toBeNull();
  await page.screenshot({ path: '../../../../../.glossa-dev/qa/map-presentation-narrow-eink.png' });
});
