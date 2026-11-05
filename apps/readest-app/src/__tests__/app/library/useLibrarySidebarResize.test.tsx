import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { useLibrarySidebarResize } from '@/app/library/hooks/useLibrarySidebarResize';

const key = 'glossa-library-sidebar-width';
function Sidebar() {
  const { resizeProps } = useLibrarySidebarResize();
  return <div {...resizeProps} aria-label='Resize sidebar' />;
}

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1100 });
  localStorage.removeItem(key);
});
afterEach(() => {
  cleanup();
  localStorage.removeItem(key);
  document.documentElement.removeAttribute('dir');
});

it('validates stored widths and clamps them to leave room for library content', () => {
  localStorage.setItem(key, '9999');
  const view = render(<Sidebar />);
  expect(screen.getByRole('separator').getAttribute('aria-valuenow')).toBe('420');
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 900 });
  fireEvent(window, new Event('resize'));
  expect(screen.getByRole('separator').getAttribute('aria-valuenow')).toBe('380');
  expect(localStorage.getItem(key)).toBe('9999');
  view.unmount();
  localStorage.setItem(key, 'invalid');
  render(<Sidebar />);
  expect(screen.getByRole('separator').getAttribute('aria-valuenow')).toBe('208');
});

it('supports keyboard resizing, bounds and RTL while saving only the local width', () => {
  render(<Sidebar />);
  const edge = screen.getByRole('separator');
  fireEvent.keyDown(edge, { key: 'ArrowRight' });
  expect(edge.getAttribute('aria-valuenow')).toBe('218');
  expect(localStorage.getItem(key)).toBe('218');
  edge.style.direction = 'rtl';
  fireEvent.keyDown(edge, { key: 'ArrowLeft', shiftKey: true });
  expect(edge.getAttribute('aria-valuenow')).toBe('248');
  fireEvent.keyDown(edge, { key: 'Home' });
  expect(edge.getAttribute('aria-valuenow')).toBe('180');
  fireEvent.keyDown(edge, { key: 'End' });
  expect(edge.getAttribute('aria-valuenow')).toBe('420');
});

it('cancels pointer resizing without persisting a transient width', () => {
  render(<Sidebar />);
  const edge = screen.getByRole('separator');
  Object.defineProperty(edge, 'setPointerCapture', { value: () => {} });
  fireEvent.pointerDown(edge, { button: 0, isPrimary: true, pointerId: 1, clientX: 200 });
  fireEvent.pointerMove(edge, { pointerId: 1, clientX: 280 });
  expect(edge.getAttribute('aria-valuenow')).toBe('288');
  expect(localStorage.getItem(key)).toBeNull();
  fireEvent.pointerCancel(edge, { pointerId: 1 });
  expect(edge.getAttribute('aria-valuenow')).toBe('208');
  expect(localStorage.getItem(key)).toBeNull();
  fireEvent.pointerDown(edge, { button: 0, isPrimary: true, pointerId: 2, clientX: 200 });
  fireEvent.pointerUp(edge, { pointerId: 2, clientX: 300 });
  expect(edge.getAttribute('aria-valuenow')).toBe('308');
  expect(localStorage.getItem(key)).toBe('308');
});

it.each([
  'escape',
  'blur',
])('restores the starting width when a drag is cancelled by %s', (reason) => {
  localStorage.setItem(key, '240');
  render(<Sidebar />);
  const edge = screen.getByRole('separator');
  Object.defineProperty(edge, 'setPointerCapture', { value: () => {} });
  fireEvent.pointerDown(edge, { button: 0, isPrimary: true, pointerId: 3, clientX: 200 });
  fireEvent.pointerMove(edge, { pointerId: 3, clientX: 280 });
  expect(edge.getAttribute('aria-valuenow')).toBe('320');
  if (reason === 'escape') fireEvent.keyDown(document, { key: 'Escape' });
  else fireEvent(window, new Event('blur'));
  expect(edge.getAttribute('aria-valuenow')).toBe('240');
  fireEvent.pointerUp(edge, { pointerId: 3, clientX: 280 });
  expect(localStorage.getItem(key)).toBe('240');
});
