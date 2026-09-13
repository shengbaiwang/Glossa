import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import type { Book } from '@/types/book';
import type { BookDoc } from '@/libs/document';
import { createMap, editTree, type MapWorkspace } from '@/glossa/mindmap/workspace';
import {
  loadMapWorkspace,
  MapStorageConflict,
  saveMapWorkspace,
} from '@/glossa/mindmap/workspaceStore';
import MindmapPanel from '@/glossa/ui/MindmapPanel';
import '@/styles/globals.css';
import '@/styles/glossa.css';

const language = vi.hoisted(() => ({ chinese: false }));
vi.mock('@/hooks/useTranslation', async () => {
  const translations: Record<string, string> = await fetch('/locales/zh-CN/translation.json').then(
    (response) => response.json(),
  );
  return {
    useTranslation: () => (key: string, values?: Record<string, string | number>) => {
      const label = language.chinese
        ? (translations[key as keyof typeof translations] ?? key)
        : key;
      return label.replace(/{{(\w+)}}/g, (_, name: string) => String(values?.[name] ?? name));
    },
  };
});
// Opening and editing the new workspace must never load the model generation surface.
vi.mock('@/glossa/ai/provider', () => {
  throw new Error('Manual maps must not load a model provider');
});
afterEach(() => {
  cleanup();
  language.chinese = false;
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('dir');
  document.documentElement.removeAttribute('data-eink');
});
const book = () => ({ hash: crypto.randomUUID(), title: '阅读札记' }) as Book;
const doc = {} as BookDoc;
const mount = (b: Book, width = 390) =>
  render(
    <div data-testid='sidebar' style={{ width, height: 740 }}>
      <MindmapPanel book={b} bookDoc={doc} bookKey={b.hash} />
    </div>,
  );

it('edits without AI, preserves hierarchy across views, undoes branch deletion and reopens saved state', async () => {
  const b = book();
  const view = mount(b);
  await screen.findByRole('heading', { name: 'Give your ideas a shape' });
  fireEvent.click(screen.getAllByRole('button', { name: 'New mind map' })[0]!);
  let input = await screen.findByRole('textbox', { name: 'Idea text' });
  fireEvent.change(input, { target: { value: '阅读如何成为理解' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  input = screen.getByRole('textbox', { name: 'Idea text' });
  fireEvent.change(input, { target: { value: '联系已有知识' } });
  fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });
  input = screen.getByRole('textbox', { name: 'Idea text' });
  fireEvent.change(input, { target: { value: '解释概念之间的关系' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Relationship' }), {
    target: { value: '通过' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Mind map' }));
  expect(screen.getByRole('button', { name: '通过 解释概念之间的关系' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '联系已有知识' }));
  fireEvent.keyDown(screen.getByRole('button', { name: '联系已有知识' }), {
    key: 'Delete',
  });
  expect(screen.queryByRole('button', { name: '通过 解释概念之间的关系' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
  expect(screen.getByRole('button', { name: '通过 解释概念之间的关系' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Collapse 联系已有知识' }));
  fireEvent.click(screen.getByRole('button', { name: 'Find an idea' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Find an idea' }), {
    target: { value: '概念' },
  });
  fireEvent.click(screen.getByRole('button', { name: '解释概念之间的关系' }));
  expect(screen.getByRole('button', { name: '通过 解释概念之间的关系' })).toBeTruthy();
  await waitFor(() => expect(screen.getByText('Saved on this device')).toBeTruthy());
  const stored = await loadMapWorkspace(b.hash);
  expect(stored.maps[0]?.nodes).toHaveLength(3);
  expect(stored.maps[0]?.view).toBe('map');
  view.unmount();
  mount(b);
  expect(await screen.findByRole('button', { name: '通过 解释概念之间的关系' })).toBeTruthy();
});

it('commits atomically, rejects stale writers and keeps books isolated', async () => {
  const first = await loadMapWorkspace(crypto.randomUUID());
  const map = createMap('Local');
  const next = { ...first, maps: [map], activeId: map.id };
  await saveMapWorkspace(next);
  await expect(saveMapWorkspace(next)).rejects.toBeInstanceOf(MapStorageConflict);
  expect((await loadMapWorkspace(first.bookId)).maps[0]?.nodes[0]?.label).toBe('Local');
  expect((await loadMapWorkspace(crypto.randomUUID())).maps).toEqual([]);
  await expect(saveMapWorkspace({ ...next, maps: [{ ...map, nodes: [] }] })).rejects.toThrow();
  expect((await loadMapWorkspace(first.bookId)).revision).toBe(1);
});

it('lays out Chinese branches without overlap and supports narrow, dark, RTL, e-ink and expanded views', async () => {
  await page.viewport(1280, 900);
  language.chinese = true;
  const b = book();
  let map = createMap('阅读如何成为理解');
  const root = map.nodes[0]!.id;
  const labels = ['建立概念之间的联系', '把观点放回具体情境', '检验理解的边界'];
  for (const [i, label] of labels.entries()) {
    map.nodes = editTree(map.nodes, { type: 'add', id: `b${i}`, parentId: root, label });
    for (let j = 0; j < 2; j++)
      map.nodes = editTree(map.nodes, {
        type: 'add',
        id: `b${i}c${j}`,
        parentId: `b${i}`,
        label: ['用自己的话重新组织', '保留条件、证据与反例'][j]!,
      });
  }
  map = { ...map, view: 'map', selectedId: 'b1', zoom: 1 };
  await saveMapWorkspace({
    version: 1,
    bookId: b.hash,
    revision: 0,
    activeId: map.id,
    maps: [map],
  } satisfies MapWorkspace);
  document.documentElement.setAttribute('data-theme', 'default-light');
  mount(b);
  await screen.findByRole('button', { name: labels[0]! });
  fireEvent.click(screen.getByRole('button', { name: '展开工作区' }));
  await waitFor(() => expect(document.querySelector('dialog')?.matches(':modal')).toBe(true));
  const nodes = Array.from(document.querySelectorAll('.glossa-workmap-node'));
  for (let i = 0; i < nodes.length; i++)
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i]!.getBoundingClientRect();
      const c = nodes[j]!.getBoundingClientRect();
      expect(a.right <= c.left || c.right <= a.left || a.bottom <= c.top || c.bottom <= a.top).toBe(
        true,
      );
    }
  fireEvent.click(screen.getByRole('button', { name: '适应画布' }));
  (document.activeElement as HTMLElement)?.blur();
  await page.screenshot({ path: '../../../../../.glossa-dev/qa/map-foundation-light.png' });
  document.documentElement.setAttribute('data-theme', 'default-dark');
  await page.screenshot({ path: '../../../../../.glossa-dev/qa/map-foundation-dark.png' });
  fireEvent.click(screen.getByRole('button', { name: '收起工作区' }));
  fireEvent.click(screen.getByRole('button', { name: '大纲' }));
  document.documentElement.setAttribute('data-theme', 'default-light');
  screen.getByTestId('sidebar').style.width = '280px';
  expect(document.querySelector('dialog')!.getBoundingClientRect().width).toBeLessThanOrEqual(280);
  await page.screenshot({ path: '../../../../../.glossa-dev/qa/map-foundation-outline.png' });
  document.documentElement.setAttribute('dir', 'rtl');
  document.documentElement.setAttribute('data-eink', 'true');
  await page.screenshot({ path: '../../../../../.glossa-dev/qa/map-foundation-rtl-eink.png' });
});

it('restores a validated backup as a new map and rejects malformed files without replacing work', async () => {
  const b = book();
  mount(b);
  await screen.findByRole('heading', { name: 'Give your ideas a shape' });
  const map = createMap('Recovered idea');
  const backup = {
    version: 1,
    bookId: 'original-book',
    revision: 12,
    activeId: map.id,
    maps: [map],
  };
  const upload = () => screen.getByLabelText('Import mind maps', { selector: 'input' });
  fireEvent.change(upload(), {
    target: {
      files: [new File([JSON.stringify(backup)], 'backup.json', { type: 'application/json' })],
    },
  });
  await screen.findByRole('button', { name: 'Recovered idea' });
  await waitFor(() => expect(screen.getByText('Saved on this device')).toBeTruthy());
  const saved = await loadMapWorkspace(b.hash);
  expect(saved.maps[0]?.id).not.toBe(map.id);
  expect(saved.bookId).toBe(b.hash);
  fireEvent.change(upload(), {
    target: { files: [new File(['{"nodes":"broken"}'], 'broken.json')] },
  });
  await screen.findByRole('alert');
  expect((await loadMapWorkspace(b.hash)).maps).toEqual(saved.maps);
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
  expect(screen.getByRole('heading', { name: 'Give your ideas a shape' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
  expect(screen.getByRole('button', { name: 'Recovered idea' })).toBeTruthy();
});

it('keeps the previous transaction intact when storage rejects a replacement', async () => {
  const id = crypto.randomUUID();
  const map = createMap('Safe original');
  await saveMapWorkspace({ version: 1, bookId: id, revision: 0, activeId: map.id, maps: [map] });
  const current = await loadMapWorkspace(id);
  const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
    throw new DOMException('No space', 'QuotaExceededError');
  });
  try {
    await expect(saveMapWorkspace(current)).rejects.toThrow();
  } finally {
    put.mockRestore();
  }
  expect(await loadMapWorkspace(id)).toEqual(current);
});
