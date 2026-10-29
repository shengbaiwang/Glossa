import { useRef, useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { useLibraryMarquee } from '@/app/library/hooks/useLibraryMarquee';

afterEach(cleanup);
function Shelf({ inset = false }: { inset?: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const [ids, setIds] = useState<string[]>(['old']);
  const marquee = useLibraryMarquee({
    root,
    scroller: inset ? viewport : root,
    selected: ids,
    enabled: true,
    onSelect: setIds,
  });
  return (
    <div ref={root} {...marquee.handlers} data-testid='shelf'>
      <div ref={viewport} data-testid='viewport'>
        <div data-book-hash='a' data-library-item-id='a' data-testid='a' />
        <div data-group-name='Folder' data-library-item-id='b' data-testid='b' />
      </div>
      <button type='button'>Import</button>
      <output>{ids.join(',')}</output>
      {marquee.rect && <div data-testid='rectangle' />}
    </div>
  );
}
function setup(inset = false) {
  render(<Shelf inset={inset} />);
  for (const [id, left] of [
    ['a', 20],
    ['b', 120],
  ] as const)
    screen.getByTestId(id).getBoundingClientRect = () => ({
      left,
      top: 20,
      right: left + 80,
      bottom: 120,
      width: 80,
      height: 100,
      x: left,
      y: 20,
      toJSON() {},
    });
  return screen.getByTestId('shelf');
}
const down = (target: HTMLElement, extra = {}) =>
  fireEvent.pointerDown(target, {
    pointerId: 1,
    pointerType: 'mouse',
    button: 0,
    clientX: 5,
    clientY: 5,
    ...extra,
  });
const move = (x: number, y: number, id = 1) =>
  fireEvent.pointerMove(document, { pointerId: id, pointerType: 'mouse', clientX: x, clientY: y });
const up = () => fireEvent.pointerUp(document, { pointerId: 1, pointerType: 'mouse' });

it('selects intersecting books from blank space and preserves the set after release', () => {
  const shelf = setup();
  down(shelf);
  move(210, 130);
  expect(screen.getByTestId('rectangle')).toBeTruthy();
  expect(screen.getByText('a,b')).toBeTruthy();
  up();
  expect(screen.queryByTestId('rectangle')).toBeNull();
  expect(screen.getByText('a,b')).toBeTruthy();
});
it('includes blank shelf insets outside the scroll viewport without capturing its scrollbar', () => {
  const shelf = setup(true);
  const viewport = screen.getByTestId('viewport');
  shelf.getBoundingClientRect = () => new DOMRect(0, 0, 240, 160);
  viewport.getBoundingClientRect = () => new DOMRect(20, 0, 200, 160);
  Object.defineProperty(viewport, 'clientWidth', { value: 184 });
  down(shelf, { clientX: 210 });
  move(30, 130);
  up();
  expect(screen.getByText('old')).toBeTruthy();
  down(shelf);
  move(210, 130);
  up();
  expect(screen.getByText('a,b')).toBeTruthy();
});
it('adds to the previous set with a modifier and shrinks selection when dragging back', () => {
  const shelf = setup();
  down(shelf, { shiftKey: true });
  move(210, 130);
  move(105, 130);
  expect(screen.getByText('old,a')).toBeTruthy();
  up();
});
it('restores the previous selection when cancelled and ignores other pointers', () => {
  const shelf = setup();
  down(shelf);
  move(210, 130, 2);
  expect(screen.queryByTestId('rectangle')).toBeNull();
  move(210, 130);
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.getByText('old')).toBeTruthy();
});
it('leaves book drags, controls and touch scrolling to their existing interactions', () => {
  setup();
  down(screen.getByTestId('a'));
  move(210, 130);
  up();
  down(screen.getByRole('button'));
  move(210, 130);
  up();
  down(screen.getByTestId('shelf'), { pointerType: 'touch' });
  move(210, 130);
  up();
  expect(screen.getByText('old')).toBeTruthy();
});

it('selects a duplicate recent/grid identity by either rectangle', () => {
  const shelf = setup();
  const duplicate = document.createElement('div');
  duplicate.dataset['libraryItemId'] = 'a';
  duplicate.getBoundingClientRect = () => new DOMRect(320, 320, 80, 100);
  screen.getByTestId('viewport').append(duplicate);
  down(shelf);
  move(105, 130);
  up();
  expect(screen.getByText('a')).toBeTruthy();
});
