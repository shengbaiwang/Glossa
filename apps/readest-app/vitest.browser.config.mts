import { resolve } from 'node:path';
import tsconfigPaths from 'vite-tsconfig-paths';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import { loadEnvFile } from './vitest.env.mts';

// Load .env and .env.web so browser tests have the same env as the web app.
const env = { ...loadEnvFile('.env'), ...loadEnvFile('.env.web') };

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  define: {
    'process.env': JSON.stringify(env),
  },
  resolve: {
    conditions: ['development'],
    alias: { '@pdfjs': resolve(__dirname, 'public/vendor/pdfjs') },
  },
  optimizeDeps: {
    include: [
      '@supabase/supabase-js',
      'next/link',
      'react-icons/fc',
      '@tauri-apps/plugin-fs',
      '@tauri-apps/plugin-http',
      '@tauri-apps/api/path',
      '@tauri-apps/api/core',
      '@testing-library/react',
      '@radix-ui/react-dialog',
      '@radix-ui/react-slot',
      '@radix-ui/react-dropdown-menu',
      'react-virtuoso',
      'class-variance-authority',
      'tailwind-merge',
      'react-markdown',
      'remark-gfm',
      'marked',
      'marked-katex-extension',
      'katex',
      'dompurify',
      '@zip.js/zip.js',
      'franc-min',
      'iso-639-2',
      'iso-639-3',
      'js-md5',
      'jwt-decode',
      'uuid',
    ],
    exclude: [
      '@pdfjs/pdf.min.mjs',
      '@readest/turso-database-wasm',
      '@readest/turso-database-wasm-common',
      '@readest/turso-database-common',
    ],
  },
  server: {
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
  },
  test: {
    include: ['src/**/*.browser.test.ts', 'src/**/*.browser.test.tsx'],
    onConsoleLog(_log, type) {
      if (type === 'stdout') return false;
    },
    browser: {
      commands: {
        async dragPDFHandle({ page, frame }, from: { x: number; y: number }, to: { x: number; y: number }, cancel = false, secondFinger = false) {
          const testFrame = await frame();
          const bounds = await testFrame.frameElement().then(element => element.boundingBox());
          if (!bounds) throw new Error('Missing test frame');
          const scale = bounds.width / await testFrame.evaluate(() => window.innerWidth);
          const client = await page.context().newCDPSession(page);
          const touch = (point: { x: number; y: number }) => [{ x: bounds.x + point.x * scale, y: bounds.y + point.y * scale, id: 1, radiusX: 4, radiusY: 4, force: 1 }];
          const secondary = { ...touch(from)[0]!, x: touch(from)[0]!.x + 3, id: 2 };
          try {
            await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touch(from) });
            if (secondFinger) await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [...touch(from), secondary] });
            for (let i = 1; i <= 16; i++) {
              const primary = touch({ x: from.x + (to.x - from.x) * i / 16, y: from.y + (to.y - from.y) * i / 16 });
              await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: secondFinger && i <= 8 ? [...primary, secondary] : primary });
              if (secondFinger && i === 8) await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [secondary] });
            }
            await client.send('Input.dispatchTouchEvent', { type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: [] });
          } finally { await client.detach(); }
        },
        async pressPDFSelectionKey({ page }, key: string) {
          await page.keyboard.press(key);
        },
        async clickPDFText({ page, frame }, point: { x: number; y: number }, shift = false) {
          const testFrame = await frame();
          const bounds = await testFrame.frameElement().then((element) => element.boundingBox());
          if (!bounds) throw new Error('Missing test frame');
          const width = await testFrame.evaluate(() => window.innerWidth);
          const scale = bounds.width / width;
          if (shift) await page.keyboard.down('Shift');
          try {
            await page.mouse.click(bounds.x + point.x * scale, bounds.y + point.y * scale);
          } finally {
            if (shift) await page.keyboard.up('Shift');
          }
        },
        async doubleClickPDFText({ page, frame }, point: { x: number; y: number }) {
          const testFrame = await frame();
          const bounds = await testFrame.frameElement().then((element) => element.boundingBox());
          if (!bounds) throw new Error('Missing test frame');
          const width = await testFrame.evaluate(() => window.innerWidth);
          const scale = bounds.width / width;
          await page.mouse.dblclick(bounds.x + point.x * scale, bounds.y + point.y * scale);
        },
        async dragPDFText({ page, frame }, from: { x: number; y: number }, to: { x: number; y: number }, pauseAtEndMs = 0, via?: { x: number; y: number }) {
          const testFrame = await frame();
          const bounds = await testFrame.frameElement().then((element) => element.boundingBox());
          if (!bounds) throw new Error('Missing test frame');
          const width = await testFrame.evaluate(() => window.innerWidth);
          const scale = bounds.width / width;
          await page.mouse.move(bounds.x + from.x * scale, bounds.y + from.y * scale);
          await page.mouse.down();
          try {
            if (via) await page.mouse.move(bounds.x + via.x * scale, bounds.y + via.y * scale, { steps: 16 });
            await page.mouse.move(bounds.x + to.x * scale, bounds.y + to.y * scale, { steps: 16 });
            if (pauseAtEndMs) await new Promise((resolve) => setTimeout(resolve, pauseAtEndMs));
          } finally {
            await page.mouse.up();
          }
        },
      },
      enabled: true,
      headless: true,
      screenshotFailures: false,
      provider: playwright({
        contextOptions: {
          viewport: { width: 1920, height: 1080 },
          deviceScaleFactor: 2,
        },
      }),
      instances: [{ browser: 'chromium' }],
      expect: {
        toMatchScreenshot: {
          comparatorName: 'pixelmatch',
          comparatorOptions: {
            threshold: 0.1,
            allowedMismatchedPixelRatio: 0.02,
          },
          // Strip platform from the path so one baseline works on macOS and Linux.
          // Must be absolute: vitest runs the path through Vite's `server.fs`
          // access check before writing, and a relative path is always denied,
          // which surfaces as "Couldn't write file to fs" when generating
          // baselines (reads still worked because they resolve against cwd).
          resolveScreenshotPath: ({ arg, browserName, ext, root, testFileDirectory, testFileName }) =>
            resolve(root, testFileDirectory, '__screenshots__', testFileName, `${arg}-${browserName}${ext}`),
        },
      },
    },
  },
});
