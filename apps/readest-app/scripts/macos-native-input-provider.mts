import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { createInterface } from 'node:readline';
import {
  WebdriverBrowserProvider,
  webdriverio,
  type WebdriverProviderOptions,
} from '@vitest/browser-webdriverio';
import type { TestProject } from 'vitest/node';

const elementKey = 'element-6066-11e4-a52e-4f735466cecf';
type Point = { x: number; y: number };
declare module 'vitest/browser' {
  interface BrowserCommands {
    __vitest_dblClick: (selector: string, options?: { position?: Point }) => Promise<void>;
  }
}
type Bounds = Point & { width: number; height: number };
type Geometry = { contentBounds?: Bounds; windowBounds?: Bounds };
type NativeEvent =
  | ({ type: 'move' | 'down' | 'up'; button: number; clickCount?: number } & Point)
  | { type: 'keyDown' | 'keyUp'; key: string }
  | { type: 'pause'; durationMs: number };
type Action = {
  type: string;
  x?: number;
  y?: number;
  duration?: number;
  button?: number;
  value?: string;
  origin?: string | Record<string, string>;
};
type Sequence = { type: string; actions: Action[]; parameters?: { pointerType?: string } };
export type NativeInputOptions = {
  targetPid: number;
  expectedExecutable: string;
  helperPath: string;
};

/** Test-only native input. Never connect this provider to a personal application. */
class NativeInput {
  private child: ChildProcessWithoutNullStreams;
  private counter = 0;
  private pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private failure: Error | undefined;

  constructor(private options: NativeInputOptions) {
    if (process.platform !== 'darwin' || !Number.isSafeInteger(options.targetPid) || options.targetPid < 1)
      throw new Error('Native input requires macOS and an explicit test-process PID');
    this.options = {
      ...options,
      expectedExecutable: realpathSync(options.expectedExecutable),
      helperPath: realpathSync(options.helperPath),
    };
    this.child = spawn(this.options.helperPath, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' },
    });
    const lines = createInterface({ input: this.child.stdout });
    lines.on('line', (line) => {
      try {
        if (line.length > 65536) throw new Error('Native-input response exceeded the limit');
        const result = JSON.parse(line) as {
          id: number;
          ok: boolean;
          value?: unknown;
          error?: string;
        };
        const request = this.pending.get(result.id);
        if (!request) throw new Error('Unexpected native-input response');
        this.pending.delete(result.id);
        if (result.ok) request.resolve(result.value);
        else request.reject(new Error(result.error ?? 'Native-input operation failed'));
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
    this.child.stderr.resume();
    this.child.on('error', (error) => this.fail(error));
    this.child.on('exit', (code, signal) =>
      this.fail(new Error(`Native input exited (${code ?? signal})`)),
    );
  }

  private fail(error: Error) {
    this.failure ??= error;
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
  }

  async request(operation: 'geometry' | 'events' | 'release' | 'shutdown', events?: NativeEvent[]) {
    if (this.failure) throw this.failure;
    const id = ++this.counter;
    const request = { id, ...this.options, helperPath: undefined, operation, events };
    const response = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    this.child.stdin.write(`${JSON.stringify(request)}\n`, (error) => {
      if (error) this.fail(error);
    });
    const timeout = setTimeout(() => {
      this.fail(new Error('Native input exceeded 30 seconds'));
      this.child.kill();
    }, operation === 'shutdown' ? 1000 : 30000);
    try {
      return await response;
    } finally {
      clearTimeout(timeout);
    }
  }

  async close() {
    let clipboardRestored = false;
    try {
      if (!this.failure) {
        const result = (await this.request('shutdown')) as {
          clipboardRestoredAndVerified?: boolean;
        } | null;
        clipboardRestored = result?.clipboardRestoredAndVerified === true;
      }
    } finally {
      console.info(`Native test-input cleanup: ${JSON.stringify({ clipboardRestored })}`);
      this.child.stdin.end();
      if (this.child.exitCode === null && this.child.signalCode === null) {
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => {
            this.child.kill();
            resolve();
          }, 1000);
          this.child.once('exit', () => {
            clearTimeout(timeout);
            resolve();
          });
        });
      }
    }
  }
}

class MacOSNativeProvider extends WebdriverBrowserProvider {
  private input: NativeInput;
  private installed = false;
  private identityVerified = false;
  private queue: Promise<unknown> = Promise.resolve();
  private pointer: Point = { x: 0, y: 0 };
  private lastGeometry = '';
  private lastRawGeometry = '';
  private actionBatch = 0;

  constructor(project: TestProject, options: WebdriverProviderOptions, input: NativeInputOptions) {
    super(project, options);
    this.input = new NativeInput(input);
    // WDIO's Vitest command drops Playwright's position option. Preserve it so
    // a block-level answer is clicked on its actual word, as the spec requests.
    if (!project.browser) throw new Error('Native input requires an initialized browser project');
    project.browser.registerCommand(
      '__vitest_dblClick',
      async (context, selector: string, options?: { position?: Point }) => {
        const element = await context.browser.$(selector);
        let offset = { x: 0, y: 0 };
        if (options?.position) {
          const rect = await context.browser.getElementRect(await element.elementId);
          offset = {
            x: options.position.x - rect.width / 2,
            y: options.position.y - rect.height / 2,
          };
        }
        await context.browser
          .action('pointer', { parameters: { pointerType: 'mouse' } })
          .move({ origin: element, ...offset })
          .down()
          .up()
          .pause(80)
          .down()
          .up()
          .perform();
      },
    );
  }

  override async openBrowser() {
    const browser = await super.openBrowser();
    if (!this.installed) {
      await browser.switchToWindow('main');
      console.info('Native test-input startup: waking the isolated test window');
      await this.input.request('geometry');
      console.info('Native test-input startup: isolated test window ready for navigation');
      this.installed = true;
      // WDIO supports protocol-command overwrites at runtime; its helper's
      // generic typing lists only the higher-level commands.
      const overwrite = browser.overwriteCommand.bind(browser) as unknown as {
        (name: 'performActions', callback: (original: unknown, actions: Sequence[]) => Promise<void>): void;
        (name: 'releaseActions', callback: () => Promise<void>): void;
        (name: 'elementClick', callback: (original: unknown, id: string) => Promise<void>): void;
        (name: 'action', callback: (original: (...args: unknown[]) => unknown, type: string, options?: unknown) => unknown): void;
      };
      overwrite('action', (original, type, options) => {
        const action = original.call(browser, type, options);
        if (type === 'key') {
          const keyboard = action as { down: (key: string) => unknown; up: (key: string) => unknown };
          for (const direction of ['down', 'up'] as const) {
            const keyAction = keyboard[direction].bind(keyboard);
            // Vitest parses {Meta>} as "Meta"; WDIO's Command is W3C U+E03D.
            keyboard[direction] = (key) => keyAction(key === 'Meta' ? '\uE03D' : key);
          }
        }
        return action;
      });
      overwrite('performActions', async (_original, actions) => {
        await this.serialize(() => this.perform(actions as Sequence[]));
      });
      overwrite('releaseActions', async () => {
        await this.serialize(() => this.input.request('release'));
      });
      overwrite('elementClick', async (_original, id) => {
        await this.serialize(() =>
          this.perform([
            {
              type: 'pointer',
              parameters: { pointerType: 'mouse' },
              actions: [
                { type: 'pointerMove', origin: { [elementKey]: id }, x: 0, y: 0 },
                { type: 'pointerDown', button: 0 },
                { type: 'pointerUp', button: 0 },
              ],
            },
          ]),
        );
      });
    }
    return browser;
  }

  override async setViewport(options: { width: number; height: number }) {
    if (!this.browser) throw new Error('Native input has no browser session');
    if (![options.width, options.height].every((value) => Number.isFinite(value) && value > 0))
      throw new Error('Invalid native test viewport');
    const audit = await this.browser.execute((width: number, height: number) => {
      const topWindow = window.top!;
      const tester = topWindow.document.getElementById('vitest-tester');
      if (!tester) throw new Error('Native viewport requires Vitest browser.ui=false');
      const scale = Math.min(1, topWindow.innerWidth / width, topWindow.innerHeight / height);
      // This is Vitest's orchestrator container, outside the product document.
      // Keep its iframe viewport exact and fit only its display to the native window.
      Object.assign(tester.style, {
        position: 'fixed', left: '0px', top: '0px', right: 'auto', bottom: 'auto',
        width: `${width}px`, height: `${height}px`, margin: '0px',
        transformOrigin: '0px 0px', transform: `scale(${scale})`,
      });
      tester.setAttribute('data-scale', String(scale));
      const frame = tester.querySelector('iframe[data-vitest]') as HTMLIFrameElement | null;
      const rect = frame?.getBoundingClientRect();
      return {
        width, height, scale,
        topWidth: topWindow.innerWidth, topHeight: topWindow.innerHeight,
        frameWidth: frame?.contentWindow?.innerWidth, frameHeight: frame?.contentWindow?.innerHeight,
        rect: rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null,
      };
    }, options.width, options.height);
    console.info(`Native test-input viewport: ${JSON.stringify(audit)}`);
    if (audit.frameWidth !== options.width || audit.frameHeight !== options.height)
      throw new Error('Vitest did not apply the requested internal iframe viewport');
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async coordinates(action: Action, geometry: Geometry) {
    if (!this.browser) throw new Error('Native input has no browser session');
    const mapped = await this.browser.execute(
      (x: number, y: number, element: HTMLElement | null) => {
        if (element) {
          const rect = element.getBoundingClientRect();
          const left = Math.max(0, rect.left);
          const right = Math.min(window.innerWidth, rect.right);
          const top = Math.max(0, rect.top);
          const bottom = Math.min(window.innerHeight, rect.bottom);
          if (right <= left || bottom <= top) throw new Error('Native pointer target is outside the viewport');
          x += (left + right) / 2;
          y += (top + bottom) / 2;
        }
        if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight)
          throw new Error('Native pointer coordinates are outside the viewport');
        let current: Window = window;
        let scaleX = 1;
        let scaleY = 1;
        const frames = [];
        while (current !== current.top) {
          const frame = current.frameElement as HTMLElement | null;
          if (!frame || !frame.offsetWidth || !frame.offsetHeight)
            throw new Error('Native input cannot locate the containing iframe');
          const rect = frame.getBoundingClientRect();
          frames.push({
            rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
            innerWidth: current.innerWidth, innerHeight: current.innerHeight,
            offsetWidth: frame.offsetWidth, offsetHeight: frame.offsetHeight,
            clientLeft: frame.clientLeft, clientTop: frame.clientTop,
            transform: current.parent.getComputedStyle(frame).transform,
          });
          const sx = rect.width / frame.offsetWidth;
          const sy = rect.height / frame.offsetHeight;
          x = rect.left + (frame.clientLeft + x) * sx;
          y = rect.top + (frame.clientTop + y) * sy;
          scaleX *= sx;
          scaleY *= sy;
          current = current.parent;
        }
        return {
          x, y, scaleX, scaleY, frames,
          width: current.innerWidth, height: current.innerHeight,
          outerWidth: current.outerWidth, outerHeight: current.outerHeight,
        };
      },
      action.x ?? 0,
      action.y ?? 0,
      typeof action.origin === 'object'
        ? (action.origin as unknown as HTMLElement)
        : null,
    );
    const rawGeometry = JSON.stringify({ geometry, mapped });
    if (this.lastRawGeometry !== rawGeometry) {
      this.lastRawGeometry = rawGeometry;
      console.info(`Native test-input raw geometry: ${rawGeometry}`);
    }
    if (![mapped.x, mapped.y].every(Number.isFinite)
      || mapped.x < 0 || mapped.y < 0 || mapped.x >= mapped.width || mapped.y >= mapped.height)
      throw new Error('Native pointer target is not visible in the top-level test window');
    let bounds = geometry.contentBounds;
    if (!bounds && geometry.windowBounds) {
      const outer = geometry.windowBounds;
      if ([mapped.outerWidth, mapped.outerHeight].every((value) => Number.isFinite(value) && value > 0)) {
        const scaleX = outer.width / mapped.outerWidth;
        const scaleY = outer.height / mapped.outerHeight;
        const side = Math.max(0, (mapped.outerWidth - mapped.width) / 2);
        const top = Math.max(0, mapped.outerHeight - mapped.height - side);
        bounds = {
          x: outer.x + side * scaleX,
          y: outer.y + top * scaleY,
          width: mapped.width * scaleX,
          height: mapped.height * scaleY,
        };
      } else {
        // The isolated fixture uses Tauri's full-size overlay title bar. WKWebView
        // can report zero outer dimensions, so its content then uses AX bounds.
        bounds = { ...outer };
      }
    }
    if (!bounds) throw new Error('Native input has no test-window content geometry');
    if (![bounds.x, bounds.y, bounds.width, bounds.height, mapped.width, mapped.height].every(Number.isFinite)
      || bounds.width <= 0 || bounds.height <= 0 || mapped.width <= 0 || mapped.height <= 0)
      throw new Error('Invalid native test-window geometry');
    const audit = JSON.stringify({
      geometry,
      contentBounds: bounds,
      dom: { innerWidth: mapped.width, innerHeight: mapped.height, outerWidth: mapped.outerWidth,
        outerHeight: mapped.outerHeight, frameScaleX: mapped.scaleX, frameScaleY: mapped.scaleY },
    });
    if (this.lastGeometry !== audit) {
      this.lastGeometry = audit;
      console.info(`Native test-input coordinates: ${audit}`);
    }
    const sx = bounds.width / mapped.width;
    const sy = bounds.height / mapped.height;
    return action.origin === 'pointer'
      ? {
          x: this.pointer.x + (action.x ?? 0) * mapped.scaleX * sx,
          y: this.pointer.y + (action.y ?? 0) * mapped.scaleY * sy,
        }
      : { x: bounds.x + mapped.x * sx, y: bounds.y + mapped.y * sy };
  }

  private async perform(sequences: Sequence[]) {
    const batch = ++this.actionBatch;
    const stage = (name: string) => console.info(`Native test-input batch ${batch}: ${name}`);
    stage('verify isolated application identity');
    if (!this.identityVerified) {
      if (!this.browser) throw new Error('Native input has no browser session');
      const identifier = await this.browser.executeAsync((done: (value: unknown) => void) => {
        const owner = window.top as unknown as {
          __TAURI_INTERNALS__?: { invoke: (command: string) => Promise<unknown> };
        };
        const invoke = owner?.__TAURI_INTERNALS__?.invoke;
        if (!invoke) return done(null);
        invoke('get_app_identifier').then(done, () => done(null));
      });
      if (identifier !== 'com.bilingify.readest.webdriver-test')
        throw new Error('Native input is restricted to the isolated WebDriver test application');
      this.identityVerified = true;
    }
    stage('application identity verified; request native geometry');
    if (!Array.isArray(sequences) || sequences.length > 8)
      throw new Error('Unsupported native action sources');
    const count = Math.max(0, ...sequences.map((sequence) => sequence.actions.length));
    if (count > 1000) throw new Error('Native action request exceeded the limit');
    const geometry = (await this.input.request('geometry')) as Geometry;
    stage('native geometry ready; map action coordinates');
    const events: NativeEvent[] = [];
    for (let tick = 0; tick < count; tick++) {
      let duration = 0;
      for (const sequence of sequences) {
        const action = sequence.actions[tick];
        if (!action) continue;
        duration = Math.max(duration, action.duration ?? 0);
        if (action.type === 'pause') continue;
        if (sequence.type === 'key' && ['keyDown', 'keyUp'].includes(action.type)) {
          if (typeof action.value !== 'string') throw new Error('Invalid native key');
          events.push({ type: action.type as 'keyDown' | 'keyUp', key: action.value });
        } else if (sequence.type === 'pointer') {
          if (sequence.parameters?.pointerType && sequence.parameters.pointerType !== 'mouse')
            throw new Error('Native test provider supports mouse input only');
          if (action.type === 'pointerMove') {
            this.pointer = await this.coordinates(action, geometry);
            events.push({ type: 'move', ...this.pointer, button: 0 });
          } else if (action.type === 'pointerDown' || action.type === 'pointerUp') {
            const button = action.button ?? 0;
            if (button < 0 || button > 2) throw new Error('Unsupported native mouse button');
            events.push({
              type: action.type === 'pointerDown' ? 'down' : 'up',
              ...this.pointer,
              button,
            });
          } else throw new Error(`Unsupported native pointer action: ${action.type}`);
        } else throw new Error(`Unsupported native action source: ${sequence.type}`);
      }
      if (!Number.isFinite(duration) || duration < 0 || duration > 10000)
        throw new Error('Invalid native action duration');
      if (duration) events.push({ type: 'pause', durationMs: duration });
    }
    stage(`post ${events.length} native events`);
    await this.input.request('events', events);
    stage('native events completed');
  }

  override async close() {
    try {
      try {
        await this.serialize(() => this.input.request('release'));
      } finally {
        await super.close();
      }
    } finally {
      await this.input.close();
    }
  }
}

export function macosNativeWebdriverio(options: WebdriverProviderOptions, input?: NativeInputOptions) {
  const configuredInput = input ?? {
    targetPid: Number(process.env.GLOSSA_MACOS_INPUT_PID),
    expectedExecutable: process.env.GLOSSA_MACOS_INPUT_EXECUTABLE ?? '',
    helperPath: process.env.GLOSSA_MACOS_INPUT_HELPER ?? '',
  };
  return {
    ...webdriverio(options),
    providerFactory: (project: TestProject) => new MacOSNativeProvider(project, options, configuredInput),
  };
}
