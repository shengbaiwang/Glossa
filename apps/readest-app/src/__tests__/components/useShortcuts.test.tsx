import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import useShortcuts from '@/hooks/useShortcuts';

vi.mock('@/helpers/shortcuts', () => ({
  loadShortcuts: () => ({
    onCopySelection: { keys: ['ctrl+c', 'cmd+c'] },
    onGoRight: { keys: [' ', 'ArrowDown'] },
  }),
}));

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  cleanup();
});

it.each([
  'ctrlKey',
  'metaKey',
] as const)('leaves a top-document text selection to native copy with %s', (modifier) => {
  const copyBookSelection = vi.fn(() => true);
  function Fixture() {
    useShortcuts({ onCopySelection: copyBookSelection });
    return <p>Selected conversation text</p>;
  }
  const { getByText } = render(<Fixture />);
  const range = document.createRange();
  range.selectNodeContents(getByText('Selected conversation text'));
  window.getSelection()?.addRange(range);
  // Selecting non-focusable text can leave key events targeting the body.
  expect(fireEvent.keyDown(document.body, { key: 'c', [modifier]: true })).toBe(true);
  expect(copyBookSelection).not.toHaveBeenCalled();

  window.getSelection()?.removeAllRanges();
  fireEvent.keyDown(document.body, { key: 'c', [modifier]: true });
  expect(copyBookSelection).toHaveBeenCalledTimes(1);
});

it('keeps forwarded book selection shortcuts working', () => {
  const copyBookSelection = vi.fn();
  function Fixture() {
    useShortcuts({ onCopySelection: copyBookSelection });
    return null;
  }
  render(<Fixture />);
  fireEvent(
    window,
    new MessageEvent('message', {
      data: {
        type: 'iframe-keydown',
        key: 'c',
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        altKey: false,
      },
    }),
  );
  expect(copyBookSelection).toHaveBeenCalledTimes(1);
});

it.each([' ', 'ArrowDown'])('leaves a consumed %j key to its focused control', (key) => {
  const turnPage = vi.fn(() => true);
  function Fixture() {
    useShortcuts({ onGoRight: turnPage });
    return <button onKeyDown={(event) => event.preventDefault()}>Zoom</button>;
  }
  const { getByRole } = render(<Fixture />);
  const control = getByRole('button');
  control.focus();
  fireEvent.keyDown(control, { key });
  expect(turnPage).not.toHaveBeenCalled();
  control.blur();
  fireEvent.keyDown(document.body, { key });
  expect(turnPage).toHaveBeenCalledTimes(1);
});
