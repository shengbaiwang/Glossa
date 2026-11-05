import './modelSettings.browser.test';
import { beforeAll, expect } from 'vitest';
import { invoke } from '@tauri-apps/api/core';

beforeAll(async () => {
  expect(await invoke('get_app_identifier')).toBe('com.bilingify.readest.webdriver-test');
});
