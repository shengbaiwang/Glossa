import { resolve } from 'node:path';
import tsconfigPaths from 'vite-tsconfig-paths';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { webdriverio } from '@vitest/browser-webdriverio';
import { loadEnvFile } from './vitest.env.mts';
import { macosNativeWebdriverio } from './scripts/macos-native-input-provider.mts';

// Load .env and .env.tauri so tauri tests have the same env as the desktop app.
const env = {
  ...loadEnvFile('.env'),
  ...loadEnvFile('.env.tauri'),
  // Tauri UI specs exercise the explicit opt-in path. Product builds still
  // receive their value only from NEXT_PUBLIC_GLOSSA_ENABLED.
  NEXT_PUBLIC_GLOSSA_ENABLED: 'true',
  CWD: process.cwd(),
};

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
      '@radix-ui/react-dialog',
      '@radix-ui/react-dropdown-menu',
      'tailwind-merge',
      '@supabase/supabase-js',
      '@tauri-apps/plugin-fs',
      '@tauri-apps/plugin-http',
      '@tauri-apps/api/path',
      '@tauri-apps/api/core',
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
  test: {
    include: ['src/**/*.tauri.test.{ts,tsx}'],
    setupFiles: ['./vitest.tauri.setup.ts'],
    testTimeout: 30000,
    browser: {
      commands: {
        async recordNativePDFEvidence(_context, evidence: Record<string, unknown>) {
          console.info('Native PDF interaction evidence', JSON.stringify(evidence));
        },
        async nativeDragPDFText(
          { browser },
          from: { x: number; y: number },
          to: { x: number; y: number },
          via: { x: number; y: number },
        ) {
          const moves = [via, to].flatMap((end, leg) => {
            const start = leg ? via : from;
            return Array.from({ length: 8 }, (_, index) => ({
              type: 'pointerMove' as const,
              origin: 'viewport' as const,
              x: start.x + (end.x - start.x) * (index + 1) / 8,
              y: start.y + (end.y - start.y) * (index + 1) / 8,
              duration: 16,
            }));
          });
          try {
            await browser.performActions([{
              type: 'pointer', id: 'native-pdf-mouse',
              parameters: { pointerType: 'mouse' },
              actions: [
                { type: 'pointerMove', origin: 'viewport', x: from.x, y: from.y },
                { type: 'pointerDown', button: 0 },
                ...moves,
                { type: 'pointerUp', button: 0 },
              ],
            }]);
          } finally { await browser.releaseActions(); }
        },
        async dragPDFText(
          { browser },
          from: { x: number; y: number },
          to: { x: number; y: number },
          pauseAtEndMs = 0,
          via = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 },
        ) {
          const moves = [via, to].flatMap((end, leg) => {
            const start = leg ? via : from;
            return Array.from({ length: 8 }, (_, index) => ({
              type: 'pointerMove' as const,
              origin: 'viewport' as const,
              x: start.x + (end.x - start.x) * (index + 1) / 8,
              y: start.y + (end.y - start.y) * (index + 1) / 8,
              duration: 16,
            }));
          });
          try {
            await browser.performActions([{
              type: 'pointer', id: 'native-pdf-mouse',
              parameters: { pointerType: 'mouse' },
              actions: [
                { type: 'pointerMove', origin: 'viewport', x: from.x, y: from.y },
                { type: 'pointerDown', button: 0 },
                ...moves,
                { type: 'pause', duration: pauseAtEndMs },
                { type: 'pointerUp', button: 0 },
              ],
            }]);
          } finally { await browser.releaseActions(); }
        },
      },
      enabled: true,
      ui: process.env.GLOSSA_MACOS_INPUT_PID ? false : undefined,
      provider: (process.env.GLOSSA_MACOS_INPUT_PID ? macosNativeWebdriverio : webdriverio)({
        hostname: '127.0.0.1',
        port: 4445,
        capabilities: {
          browserName: 'chrome',
        } as WebdriverIO.Capabilities,
      }),
      instances: [{ browser: 'chrome' }],
    },
  },
});
