// Run with Node 24: node --test scripts/test-native-clip.mjs.
// This verifies the DOM contract; it does not replace macOS WebView acceptance.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { JSDOM } from 'jsdom';

const source = readFileSync(new URL('../src-tauri/src/clip_capture.js', import.meta.url), 'utf8');
const defaults = {
  interactive: false,
  capture: false,
  maxChars: 8 * 1024 * 1024,
  captureLabel: 'Save current content',
  cancelLabel: 'Cancel',
  hint: 'Open the article, then save its content.',
  background: '#fff',
  foreground: '#111',
};
const fixture = () => new JSDOM('<!doctype html><html><head><base href="https://cdn.example.org/assets/"><title>Original article</title></head><body><article><p>Before <em>selected text</em> after.</p><p>Another paragraph.</p></article></body></html>', {
  url: 'https://example.org/redirected/article',
  runScripts: 'outside-only',
});
const evaluate = (dom, options = {}) => dom.window.eval(source.replace('__GLOSSA_CONFIG__', JSON.stringify({ ...defaults, ...options })));

test('snapshot returns actual final and base URLs without changing navigation', () => {
  const dom = fixture();
  const result = evaluate(dom, { capture: true });
  assert.equal(result.finalUrl, 'https://example.org/redirected/article');
  assert.equal(result.baseUrl, 'https://cdn.example.org/assets/');
  assert.match(result.html, /<em>selected text<\/em>/);
  assert.equal(result.selection, false);
  assert.equal(dom.window.location.href, result.finalUrl);
  dom.window.close();
});

test('short articles and equal-length middle edits change readiness signatures', () => {
  const dom = fixture();
  const initial = evaluate(dom).signature;
  assert.ok(initial);
  dom.window.document.querySelector('em').textContent = 'modified text';
  assert.notEqual(evaluate(dom).signature, initial);
  dom.window.close();
});

test('interactive capture waits for the user and preserves rich selected content', () => {
  const dom = fixture();
  assert.equal(evaluate(dom, { interactive: true }).html, undefined);
  const range = dom.window.document.createRange();
  range.selectNode(dom.window.document.querySelector('em'));
  dom.window.getSelection().addRange(range);
  const toolbar = dom.window.document.getElementById('__glossa_capture_toolbar__');
  toolbar.querySelectorAll('button')[1].click();
  const result = evaluate(dom, { interactive: true });
  assert.equal(result.selection, true);
  assert.match(result.html, /<article><em>selected text<\/em><\/article>/);
  assert.doesNotMatch(result.html, /Another paragraph|__glossa_capture_toolbar__/);
  assert.equal(result.baseUrl, 'https://cdn.example.org/assets/');
  dom.window.close();
});

test('cancel stops interactive capture before a snapshot is returned', () => {
  const dom = fixture();
  evaluate(dom, { interactive: true });
  dom.window.document.querySelector('#__glossa_capture_toolbar__ button').click();
  const result = evaluate(dom, { interactive: true });
  assert.equal(result.cancelled, true);
  assert.equal(result.html, undefined);
  dom.window.close();
});

test('oversized content is rejected before returning HTML', () => {
  const dom = fixture();
  const result = evaluate(dom, { capture: true, maxChars: 10 });
  assert.equal(result.error, 'Page is too large to capture');
  assert.equal(result.html, undefined);
  dom.window.close();
});

test('subframes cannot produce capture results', () => {
  const dom = fixture();
  const frame = dom.window.document.createElement('iframe');
  dom.window.document.body.append(frame);
  const result = frame.contentWindow.eval(source.replace('__GLOSSA_CONFIG__', JSON.stringify({ ...defaults, capture: true })));
  assert.equal(Object.keys(result).length, 0);
  dom.window.close();
});
