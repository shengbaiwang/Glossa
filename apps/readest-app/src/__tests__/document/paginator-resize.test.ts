import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Paginator } from 'foliate-js/paginator.js';

interface ObservedResize {
  callback: ResizeObserverCallback;
  observe: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  unobserve: ReturnType<typeof vi.fn>;
}

const observers: ObservedResize[] = [];
let frameCallbacks: Map<number, FrameRequestCallback>;
let paginator: InstanceType<typeof Paginator>;

const resize = (width: number, height: number) => {
  const observer = observers[0]!;
  observer.callback(
    [{ contentRect: { width, height } } as ResizeObserverEntry],
    observer as unknown as ResizeObserver,
  );
};
const paint = () => {
  const pending = [...frameCallbacks.values()];
  frameCallbacks.clear();
  pending.forEach((callback) => callback(0));
};

beforeEach(() => {
  observers.length = 0;
  frameCallbacks = new Map();
  let nextFrame = 1;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
      constructor(public callback: ResizeObserverCallback) {
        observers.push(this);
      }
    },
  );
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = nextFrame++;
    frameCallbacks.set(id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frameCallbacks.delete(id));
  paginator = new Paginator();
});

afterEach(() => {
  paginator.destroy();
  vi.unstubAllGlobals();
});

describe('paginator window resizing', () => {
  it('combines repeated size changes into one render at the next paint', () => {
    const render = vi.spyOn(paginator, 'render');
    resize(800, 600);
    resize(790, 600);
    resize(780, 600);
    expect(render).not.toHaveBeenCalled();
    paint();
    expect(render).toHaveBeenCalledOnce();
    resize(780, 600);
    paint();
    expect(render).toHaveBeenCalledOnce();
    resize(780, 610);
    paint();
    expect(render).toHaveBeenCalledTimes(2);
  });

  it('keeps explicit renders synchronous when a resize is queued', () => {
    const render = vi.spyOn(paginator, 'render');
    resize(800, 600);
    paginator.render();
    expect(render).toHaveBeenCalledOnce();
  });

  it('disconnects the observer and cancels a pending render when closed', () => {
    const render = vi.spyOn(paginator, 'render');
    resize(800, 600);
    paginator.destroy();
    expect(observers[0]!.disconnect).toHaveBeenCalledOnce();
    paint();
    expect(render).not.toHaveBeenCalled();
  });
});
