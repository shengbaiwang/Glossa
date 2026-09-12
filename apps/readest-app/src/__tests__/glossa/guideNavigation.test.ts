import { describe, expect, it, vi } from 'vitest';
import type { FoliateView } from '@/types/view';
import { navigateGuideSource } from '@/glossa/citations/navigation';

type View = Pick<FoliateView, 'goTo' | 'lastLocation'>;
const origin = 'epubcfi(/6/2!/4/2/1:0)';
const target = 'epubcfi(/6/4!/4/2/1:8)';
const visible = 'epubcfi(/6/4!/4/2,/1:4,/1:12)';
const signal = () => new AbortController().signal;

const deferred = () => {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};

describe('guide source navigation', () => {
  it('awaits the actual goTo promise and serializes calls on the same view', async () => {
    const firstMove = deferred();
    const goTo = vi.fn().mockReturnValueOnce(firstMove.promise).mockResolvedValue(undefined);
    const view: View = { goTo };
    const first = navigateGuideSource(view, target, signal());
    const second = navigateGuideSource(view, origin, signal());
    await vi.waitFor(() => expect(goTo).toHaveBeenCalledTimes(1));
    expect(goTo).toHaveBeenCalledWith(target);
    firstMove.resolve();
    await Promise.all([first, second]);
    expect(goTo.mock.calls.map(([location]) => location)).toEqual([target, origin]);
  });

  it('skips an aborted queued request without blocking the next live request', async () => {
    const firstMove = deferred();
    const goTo = vi.fn().mockReturnValueOnce(firstMove.promise).mockResolvedValue(undefined);
    const view: View = { goTo };
    const first = navigateGuideSource(view, target, signal());
    const cancelled = new AbortController();
    const second = navigateGuideSource(view, 'obsolete', cancelled.signal);
    const rejected = expect(second).rejects.toMatchObject({ name: 'AbortError' });
    const third = navigateGuideSource(view, origin, signal());
    cancelled.abort();
    await vi.waitFor(() => expect(goTo).toHaveBeenCalledTimes(1));
    firstMove.resolve();
    await Promise.all([first, rejected, third]);
    expect(goTo.mock.calls.map(([location]) => location)).toEqual([target, origin]);
  });

  it('waits for an aborted in-flight jump before letting the return jump run', async () => {
    const firstMove = deferred();
    const goTo = vi.fn().mockReturnValueOnce(firstMove.promise).mockResolvedValue(undefined);
    const view: View = { goTo };
    const controller = new AbortController();
    const first = navigateGuideSource(view, target, controller.signal);
    const rejected = expect(first).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(goTo).toHaveBeenCalledTimes(1));
    controller.abort();
    const back = navigateGuideSource(view, origin, signal());
    await Promise.resolve();
    expect(goTo).toHaveBeenCalledTimes(1);
    firstMove.resolve();
    await Promise.all([rejected, back]);
    expect(goTo).toHaveBeenLastCalledWith(origin);
  });

  it('does not navigate an already-aborted request', async () => {
    const goTo = vi.fn();
    const controller = new AbortController();
    controller.abort();
    await expect(navigateGuideSource({ goTo }, target, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(goTo).not.toHaveBeenCalled();
  });

  it('recovers the queue after a rejected jump', async () => {
    const firstMove = deferred();
    const goTo = vi.fn().mockReturnValueOnce(firstMove.promise).mockResolvedValue(undefined);
    const view: View = { goTo };
    const first = navigateGuideSource(view, target, signal());
    const failed = expect(first).rejects.toThrow('load failed');
    const second = navigateGuideSource(view, origin, signal());
    await vi.waitFor(() => expect(goTo).toHaveBeenCalledTimes(1));
    firstMove.reject(new Error('load failed'));
    await Promise.all([failed, second]);
    expect(goTo).toHaveBeenLastCalledWith(origin);
  });

  it('lets independent book views navigate without waiting for each other', async () => {
    const pending = deferred();
    const first = navigateGuideSource({ goTo: () => pending.promise }, target, signal());
    const goTo = vi.fn();
    await navigateGuideSource({ goTo }, origin, signal());
    expect(goTo).toHaveBeenCalledWith(origin);
    pending.resolve();
    await first;
  });

  it('verifies a point or the beginning of a longer source range is visible', async () => {
    const view: View = { goTo: vi.fn(), lastLocation: { cfi: visible } };
    await expect(navigateGuideSource(view, target, signal())).resolves.toBeUndefined();
    await expect(
      navigateGuideSource(view, 'epubcfi(/6/4!/4/2,/1:8,/1:99)', signal()),
    ).resolves.toBeUndefined();
  });

  it('checks the updated location and rejects a silently ignored jump', async () => {
    const view: View = { goTo: vi.fn(), lastLocation: { cfi: origin } };
    await expect(navigateGuideSource(view, target, signal())).rejects.toThrow('not reached');
    view.goTo = () => {
      view.lastLocation = { cfi: visible };
    };
    await expect(navigateGuideSource(view, target, signal())).resolves.toBeUndefined();
  });

  it('does not accept a source whose start is before the visible range', async () => {
    const view: View = { goTo: vi.fn(), lastLocation: { cfi: visible } };
    await expect(
      navigateGuideSource(view, 'epubcfi(/6/4!/4/2,/1:0,/1:99)', signal()),
    ).rejects.toThrow('not reached');
  });

  it('rejects missing or malformed live location evidence', async () => {
    await expect(
      navigateGuideSource({ goTo: vi.fn(), lastLocation: {} }, target, signal()),
    ).rejects.toThrow('not reached');
    await expect(
      navigateGuideSource({ goTo: vi.fn(), lastLocation: { cfi: 'invalid' } }, target, signal()),
    ).rejects.toThrow('not reached');
    await expect(
      navigateGuideSource({ goTo: vi.fn(), lastLocation: { cfi: visible } }, 'invalid', signal()),
    ).rejects.toThrow('not reached');
  });
});
