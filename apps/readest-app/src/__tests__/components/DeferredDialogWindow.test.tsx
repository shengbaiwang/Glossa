import { lazy, StrictMode, useEffect, useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import DeferredDialogWindow from '@/components/DeferredDialogWindow';

afterEach(cleanup);

const show = (visible: boolean) => {
  act(() => {
    document
      .getElementById('deferred-fixture')!
      .dispatchEvent(new CustomEvent('setDialogVisibility', { detail: { visible } }));
  });
};

function fixture(strict = false) {
  const opened = vi.fn();
  let resolve!: (value: { default: () => React.JSX.Element }) => void;
  const load = vi.fn(
    () =>
      new Promise<{ default: () => React.JSX.Element }>((done) => {
        resolve = done;
      }),
  );
  const Dialog = () => {
    const [visible, setVisible] = useState(false);
    useEffect(() => {
      const element = document.getElementById('deferred-fixture')!;
      const handler = (event: Event) => {
        const next = (event as CustomEvent).detail.visible;
        setVisible(next);
        if (next) opened();
      };
      element.addEventListener('setDialogVisibility', handler);
      return () => element.removeEventListener('setDialogVisibility', handler);
    }, []);
    return <div id='deferred-fixture'>{visible ? 'Opened dialog' : 'Closed dialog'}</div>;
  };
  const Lazy = lazy(load);
  const window = (
    <DeferredDialogWindow id='deferred-fixture'>
      <Lazy />
    </DeferredDialogWindow>
  );
  render(strict ? <StrictMode>{window}</StrictMode> : window);
  return { load, opened, resolve: async () => act(async () => resolve({ default: Dialog })) };
}

it('loads no dialog implementation until the first open request and preserves that request', async () => {
  const check = fixture();
  expect(check.load).not.toHaveBeenCalled();
  show(true);
  expect(check.load).toHaveBeenCalledTimes(1);
  await check.resolve();
  expect(await screen.findByText('Opened dialog')).toBeTruthy();
  expect(check.opened).toHaveBeenCalledTimes(1);
});

it('replays a single first-open request under StrictMode', async () => {
  const check = fixture(true);
  show(true);
  await check.resolve();
  expect(await screen.findByText('Opened dialog')).toBeTruthy();
  expect(check.opened).toHaveBeenCalledTimes(1);
});

it('keeps a close request made while the implementation is loading', async () => {
  const check = fixture();
  show(true);
  show(false);
  await check.resolve();
  expect(await screen.findByText('Closed dialog')).toBeTruthy();
  expect(check.opened).not.toHaveBeenCalled();
});

it('continues to deliver later opens directly without loading again or duplicating ids', async () => {
  const check = fixture();
  show(true);
  await check.resolve();
  await screen.findByText('Opened dialog');
  show(false);
  await screen.findByText('Closed dialog');
  show(true);
  await screen.findByText('Opened dialog');
  expect(check.opened).toHaveBeenCalledTimes(2);
  expect(check.load).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(document.querySelectorAll('#deferred-fixture')).toHaveLength(1));
});
