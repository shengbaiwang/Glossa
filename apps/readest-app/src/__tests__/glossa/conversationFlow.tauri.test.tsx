import './conversationFlow.browser.test';
import { beforeAll, beforeEach, expect } from 'vitest';
import { invoke } from '@tauri-apps/api/core';

beforeAll(async () => {
  expect(await invoke('get_app_identifier')).toBe('com.bilingify.readest.webdriver-test');
});

// Observe the browser's events; never dispatch events or set a selection here.
const observedTypes = [
  'mouseover',
  'mouseout',
  'dblclick',
  'keydown',
  'copy',
  'cut',
  'paste',
] as const;
beforeEach(({ onTestFinished }) => {
  const observed: Record<string, number> = {};
  const observe = (event: Event) => {
    const key = `${event.type}:${event.isTrusted ? 'trusted' : 'synthetic'}`;
    observed[key] = (observed[key] ?? 0) + 1;
  };
  for (const type of observedTypes) document.addEventListener(type, observe, true);
  // Run after fixture cleanup; a provenance assertion must never skip its afterEach.
  onTestFinished(({ task }) => {
    for (const type of observedTypes) document.removeEventListener(type, observe, true);
    console.info(
      'Native interaction provenance',
      JSON.stringify({ test: task.name, events: observed }),
    );
    if (task.result?.errors?.length) return;
    if (
      task.name ===
      'keeps selected conversation text focused and supports native copy, paste, and cut'
    ) {
      expect(observed['dblclick:trusted']).toBeGreaterThanOrEqual(2);
      for (const type of ['copy', 'cut', 'paste'])
        expect(observed[`${type}:trusted`]).toBeGreaterThanOrEqual(2);
    }
    if (
      task.name ===
        'hides absent fields in the Chinese usage card and keeps expanded details within the viewport' ||
      task.name ===
        'shows recorded usage on hover, survives reload, and fits narrow themed viewports'
    ) {
      expect(observed['mouseover:trusted']).toBeGreaterThan(0);
    }
  });
});
