import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useLongPress } from '@/hooks/useLongPress';

const Control = ({ onTap, onLongPress }: { onTap: () => void; onLongPress: () => void }) => {
  const { handlers } = useLongPress({ onTap, onLongPress }, [onTap, onLongPress]);
  return <button {...handlers}>Next</button>;
};
const pointer = { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 10, clientY: 10 };
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it('keeps each long press alive across callback updates and uses the latest callback', () => {
  const onTap = vi.fn();
  const first = vi.fn();
  const second = vi.fn();
  const { rerender } = render(<Control onTap={onTap} onLongPress={first} />);
  const button = screen.getByRole('button');
  fireEvent.pointerDown(button, pointer);
  advance(600);
  fireEvent.pointerUp(button, pointer);
  fireEvent.click(button);
  expect(first).toHaveBeenCalledOnce();

  fireEvent.pointerDown(button, pointer);
  advance(250);
  rerender(<Control onTap={onTap} onLongPress={second} />);
  advance(350);
  fireEvent.pointerUp(button, pointer);
  fireEvent.click(button);
  expect(second).toHaveBeenCalledOnce();
  expect(onTap).not.toHaveBeenCalled();
  fireEvent.pointerDown(button, pointer);
  advance(100);
  fireEvent.pointerUp(button, pointer);
  fireEvent.click(button);
  expect(onTap).toHaveBeenCalledOnce();
});

it('cancels movement and pointer cancellation, then accepts another press', () => {
  const onTap = vi.fn();
  const onLongPress = vi.fn();
  render(<Control onTap={onTap} onLongPress={onLongPress} />);
  const button = screen.getByRole('button');
  fireEvent.pointerDown(button, pointer);
  fireEvent.pointerMove(button, { ...pointer, clientX: 40 });
  advance(600);
  fireEvent.pointerUp(button, pointer);
  fireEvent.pointerDown(button, pointer);
  fireEvent.pointerCancel(button, pointer);
  advance(600);
  expect(onLongPress).not.toHaveBeenCalled();
  fireEvent.pointerDown(button, pointer);
  advance(600);
  fireEvent.pointerUp(button, pointer);
  expect(onLongPress).toHaveBeenCalledOnce();
  expect(onTap).not.toHaveBeenCalled();
});

it('cleans all pending timers on unmount', () => {
  const { unmount } = render(<Control onTap={vi.fn()} onLongPress={vi.fn()} />);
  fireEvent.pointerDown(screen.getByRole('button'), pointer);
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});
