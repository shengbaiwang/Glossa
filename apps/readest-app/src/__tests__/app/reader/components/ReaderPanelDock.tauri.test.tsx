import { useEffect, useState } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { commands, page, userEvent } from 'vitest/browser';
import { afterEach, expect, it, vi } from 'vitest';
import ReaderPanelDock from '@/app/reader/components/ReaderPanelDock';
import { Highlight } from '@/components/GlossaIcons';
import '@/styles/globals.css';
import '@/styles/glossa.css';

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
const disposed: string[] = [];
function Content({ name }: { name: string }) {
  useEffect(
    () => () => {
      disposed.push(name);
    },
    [name],
  );
  return (
    <textarea
      aria-label={`${name} draft`}
      className='m-2 min-h-0 flex-1 resize-none'
      defaultValue={name}
    />
  );
}
const panels = ['Notes', 'Conversation', 'Contents'].map((id) => ({
  id,
  label: id,
  Icon: Highlight,
  content: <Content name={id} />,
}));
function Fixture() {
  const [active, activate] = useState('Notes');
  return (
    <aside
      style={{ height: 640, width: '100%', maxWidth: 360 }}
      className='flex flex-col bg-base-100 text-base-content'
    >
      <ReaderPanelDock
        panels={panels}
        activePanel={active}
        onActivate={activate}
        onEmpty={() => {}}
      />
    </aside>
  );
}
const point = (element: Element, y = 0.5) => {
  const box = element.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height * y };
};
const drag = (from: { x: number; y: number }, to: { x: number; y: number }) =>
  commands.nativeDragPDFText(from, to, { x: from.x, y: (from.y + to.y) / 2 });
const order = () => screen.getAllByRole('region').map((node) => node.getAttribute('aria-label'));
afterEach(() => {
  cleanup();
  localStorage.removeItem('glossa.reader.panel-dock.v1');
  disposed.length = 0;
});
it('drags a live panel, resizes its boundary and closes only that panel', async () => {
  await page.viewport(960, 760);
  render(<Fixture />);
  await page.getByRole('button', { name: 'Conversation', exact: true }).click();
  const draft = screen.getByRole('textbox', { name: 'Conversation draft' });
  await userEvent.fill(draft, 'Draft survives moving');
  await drag(
    point(screen.getByRole('button', { name: 'Move panel: Conversation' })),
    point(screen.getByRole('region', { name: 'Notes' }), 0.15),
  );
  await expect.poll(order).toEqual(['Conversation', 'Notes']);
  expect(screen.getByRole('textbox', { name: 'Conversation draft' })).toBe(draft);
  const first = screen.getByRole('region', { name: 'Conversation' });
  const before = first.getBoundingClientRect().height;
  const handle = point(screen.getByRole('slider', { name: 'Resize panel: Conversation' }));
  await drag(handle, { ...handle, y: handle.y + 70 });
  expect(first.getBoundingClientRect().height).toBeGreaterThan(before + 20);
  expect(disposed).toEqual([]);
  await page.getByRole('button', { name: 'Close panel: Notes' }).click();
  expect(disposed).toEqual(['Notes']);
  expect((draft as HTMLTextAreaElement).value).toBe('Draft survives moving');
  await page.screenshot({
    path: 'test-results/dock-native.png',
  });
});
