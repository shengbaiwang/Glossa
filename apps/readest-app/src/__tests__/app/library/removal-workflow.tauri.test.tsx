// Exercise the same complete UI flow in the real macOS WebView. Its synthetic
// library adapter remains isolated; book-removal.tauri.test.ts covers real disk.
import { beforeAll, expect } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import './removal-workflow.browser.test';
beforeAll(async () => {
  expect(await invoke('get_app_identifier')).toBe('com.bilingify.readest.webdriver-test');
});
