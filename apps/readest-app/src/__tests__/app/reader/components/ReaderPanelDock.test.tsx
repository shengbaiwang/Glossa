import { useEffect } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ReaderPanelDock from '@/app/reader/components/ReaderPanelDock';
import { Highlight } from '@/components/GlossaIcons';
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
afterEach(cleanup);
const unmount = vi.fn();
function Content({ name }: { name: string }) {
  useEffect(() => () => unmount(name), [name]);
  return <input aria-label={`${name} draft`} defaultValue={name} />;
}
const panels = ['notes', 'conversation', 'mindmap'].map((id) => ({
  id,
  label: id,
  Icon: Highlight,
  content: <Content name={id} />,
}));
beforeEach(() => {
  localStorage.clear();
  unmount.mockClear();
});
it('stacks opened panels, preserves drafts when reordered, and only disposes the closed panel', () => {
  render(
    <ReaderPanelDock
      panels={panels}
      activePanel='notes'
      onActivate={() => {}}
      onEmpty={() => {}}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'conversation' }));
  expect(screen.getByLabelText('notes draft')).toBeTruthy();
  const draft = screen.getByLabelText('conversation draft');
  fireEvent.change(draft, { target: { value: 'saved in place' } });
  fireEvent.keyDown(screen.getByRole('button', { name: 'Move panel: conversation' }), {
    key: 'ArrowUp',
    altKey: true,
  });
  expect(screen.getAllByRole('region').map((node) => node.getAttribute('aria-label'))).toEqual([
    'conversation',
    'notes',
  ]);
  expect(screen.getByLabelText('conversation draft')).toBe(draft);
  expect(unmount).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Close panel: notes' }));
  expect(unmount).toHaveBeenCalledWith('notes');
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'notes' }));
  expect((draft as HTMLInputElement).value).toBe('saved in place');
});
it('keeps collapsed tasks mounted, restores geometry, and drops disabled panels', () => {
  const props = { panels, activePanel: 'notes', onActivate: () => {}, onEmpty: () => {} };
  const view = render(<ReaderPanelDock {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'conversation' }));
  fireEvent.keyDown(screen.getByRole('slider', { name: 'Resize panel: notes' }), {
    key: 'ArrowDown',
  });
  expect(localStorage.getItem('glossa.reader.panel-dock.v1')).toContain('weights');
  fireEvent.click(screen.getByRole('button', { name: 'Collapse panel: notes' }));
  expect(unmount).not.toHaveBeenCalled();
  act(() => view.rerender(<ReaderPanelDock {...props} panels={[panels[0]!]} />));
  expect(unmount).toHaveBeenCalledWith('conversation');
});
