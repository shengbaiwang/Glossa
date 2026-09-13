import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import type { Book } from '@/types/book';
import type { BookDoc } from '@/libs/document';
import { createMap, editTree } from '@/glossa/mindmap/workspace';
import { saveMapWorkspace } from '@/glossa/mindmap/workspaceStore';
import MindmapPanel from '@/glossa/ui/MindmapPanel';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));
vi.mock('@/glossa/ai/provider', () => {
  throw new Error('Editing must not load a model provider');
});
afterEach(cleanup);

async function mount(view: 'map' | 'outline' = 'map') {
  const book = { hash: crypto.randomUUID(), title: 'Keyboard fixture' } as Book;
  const map = createMap('Root');
  map.nodes = editTree(map.nodes, {
    type: 'add',
    id: 'first',
    parentId: map.nodes[0]!.id,
    label: 'First idea',
  });
  map.nodes = editTree(map.nodes, {
    type: 'add',
    id: 'second',
    parentId: map.nodes[0]!.id,
    label: 'Second idea',
  });
  map.selectedId = 'first';
  map.view = view;
  await saveMapWorkspace({
    version: 1,
    bookId: book.hash,
    revision: 0,
    activeId: map.id,
    maps: [map],
  });
  render(<MindmapPanel book={book} bookDoc={{} as BookDoc} bookKey={book.hash} />);
  await screen.findByRole('button', { name: 'Second idea' });
}

it('applies keyboard editing to the node that has keyboard focus', async () => {
  await mount();
  const second = screen.getByRole('button', { name: 'Second idea' });
  second.focus();
  await userEvent.keyboard('{Delete}');
  expect(screen.queryByRole('button', { name: 'Second idea' })).toBeNull();
  expect(screen.getByRole('button', { name: 'First idea' })).toBeTruthy();
});

it('uses Enter on an outline label to edit that idea without creating a sibling', async () => {
  await mount('outline');
  screen.getByRole('button', { name: 'Second idea' }).focus();
  await userEvent.keyboard('{Enter}');
  const editor = (await screen.findByRole('textbox', { name: 'Idea text' })) as HTMLTextAreaElement;
  expect(editor.value).toBe('Second idea');
  expect(document.querySelectorAll('[data-node-id]')).toHaveLength(3);
});

it('finishes editing when Done receives a real pointer click after editor blur', async () => {
  await mount();
  fireEvent.click(screen.getByRole('button', { name: 'Edit idea' }));
  await screen.findByRole('textbox', { name: 'Idea text' });
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Idea text' })).toBeNull());
  expect(screen.getByRole('button', { name: 'Edit idea' })).toBeTruthy();
});
