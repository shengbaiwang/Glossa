/**
 * Popup UI. Thin presentation layer over the service worker — the SW owns
 * all state and the popup re-renders on every progress broadcast.
 *
 * The popup may close at any moment (Chrome auto-dismisses on focus loss),
 * so we never persist work here. On re-open we ask the SW for the current
 * status and render whatever phase it's in.
 */

import type { ClipProgress, ClipRequest, StatusRequest, StatusResponse } from '../lib/messages';
import { localizeDom, translate as _ } from '../lib/i18n';
import {
  extensionSettingsUrl,
  hasFileSchemeAccess,
  isClippableUrl,
  isLocalFileUrl,
} from '../lib/localPage';

const LOGIN_URL = 'https://web.readest.com/';

localizeDom();

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id) as T | null;
  if (!el) throw new Error(`#${id} missing`);
  return el;
};

const signedInView = $('signed-in-view');
const signedOutView = $('signed-out-view');
const authBadge = $('auth-badge');
const pageTitle = $('page-title');
const pageUrl = $('page-url');
const downloadBtn = $<HTMLButtonElement>('download');
const sendBtn = $<HTMLButtonElement>('send');
const openReadestBtn = $<HTMLButtonElement>('open-readest');
const enableFileAccessBtn = $<HTMLButtonElement>('enable-file-access');
const progressEl = $('progress');
const progressLabel = $('progress-label');
const progressBar = progressEl.querySelector('.progress-bar') as HTMLDivElement;
const progressFill = progressEl.querySelector('.progress-bar-fill') as HTMLDivElement;
const statusEl = $('status');

let currentTabId: number | null = null;
let canCapture = false;
let signedIn = false;

function setBusy(busy: boolean): void {
  downloadBtn.disabled = busy || !canCapture;
  sendBtn.disabled = busy || !canCapture || !signedIn;
}

function setStatus(message: string, kind?: 'ok' | 'err'): void {
  statusEl.textContent = message;
  statusEl.className = `status ${kind ?? ''}`.trim();
}

function showProgress(label: string, determinate?: { done: number; total: number }): void {
  progressEl.classList.add('show');
  progressLabel.textContent = label;
  if (determinate && determinate.total > 0) {
    progressBar.classList.remove('indeterminate');
    progressFill.style.width = `${Math.round((determinate.done / determinate.total) * 100)}%`;
  } else {
    progressBar.classList.add('indeterminate');
    progressFill.style.width = '';
  }
}

function hideProgress(): void {
  progressEl.classList.remove('show');
}

function render(progress: ClipProgress | null): void {
  switch (progress?.phase) {
    case 'capturing':
      setBusy(true);
      showProgress(_('Reading page…'));
      setStatus('');
      break;
    case 'converting':
      setBusy(true);
      showProgress(_('Building EPUB…'));
      setStatus('');
      break;
    case 'uploading':
      setBusy(true);
      showProgress(_('Sending to Readest…'));
      setStatus('');
      break;
    case 'downloading':
      setBusy(true);
      showProgress(_('Saving EPUB…'));
      setStatus('');
      break;
    case 'done':
      setBusy(false);
      hideProgress();
      setStatus(doneMessage(progress.missingAssets ?? 0, progress.delivery), 'ok');
      break;
    case 'error':
      setBusy(false);
      hideProgress();
      setStatus(progress.message, 'err');
      if (progress.code === 'session-expired' || progress.code === 'not-signed-in') {
        showSignedOut();
      }
      break;
    default:
      setBusy(false);
      hideProgress();
      setStatus('');
  }
}

function doneMessage(missing: number, delivery?: 'download' | 'cloud'): string {
  if (delivery === 'download') {
    const saved = _('EPUB downloaded. Import it into Glossa.');
    if (missing <= 0) return saved;
    return `${saved} ${missing === 1 ? _('1 image could not be fetched.') : _('{count} images could not be fetched.', { count: missing })}`;
  }
  if (missing <= 0) return _('Saved to your library.');
  if (missing === 1) return _('Sent. 1 image could not be fetched.');
  return _('Sent. {count} images could not be fetched.', { count: missing });
}

function showSignedOut(): void {
  signedIn = false;
  signedInView.classList.remove('hidden');
  sendBtn.classList.add('hidden');
  signedOutView.classList.remove('hidden');
  authBadge.classList.add('hidden');
}

function showSignedIn(): void {
  signedIn = true;
  sendBtn.classList.remove('hidden');
  signedInView.classList.remove('hidden');
  signedOutView.classList.add('hidden');
  authBadge.classList.add('hidden');
}

async function init(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) currentTabId = tab.id ?? null;

  if (!tab || !isClippableUrl(tab.url)) {
    pageTitle.textContent = _('This page cannot be clipped');
    pageUrl.textContent = '';
    setBusy(true);
    return;
  }

  const url = tab.url;
  pageTitle.textContent = tab.title || url;
  pageUrl.textContent = url;

  const status = await chrome.runtime.sendMessage<StatusRequest, StatusResponse>({
    type: 'send-to-readest:status',
  });

  if (status.signedIn) showSignedIn();
  else showSignedOut();

  // A local page needs "Allow access to file URLs" on top of the extension's
  // host permissions. Ask for it up front — otherwise the clip dies deep in
  // `chrome.scripting.executeScript` with an unreadable permission error.
  if (isLocalFileUrl(url) && !(await hasFileSchemeAccess())) {
    setBusy(true);
    enableFileAccessBtn.classList.remove('hidden');
    setStatus(_('Readest needs permission to read local files.'));
    return;
  }

  canCapture = true;
  if (status.inFlight || status.lastProgress) {
    render(status.lastProgress);
  } else {
    setBusy(false);
  }
}

async function requestClip(delivery: 'download' | 'cloud'): Promise<void> {
  if (currentTabId === null || !canCapture) return;
  setBusy(true);
  showProgress(_('Starting…'));
  const request: ClipRequest = {
    type: 'send-to-readest:clip',
    tabId: currentTabId,
    ...(delivery === 'download' ? { delivery } : {}),
  };
  await chrome.runtime.sendMessage(request).catch((err: unknown) => {
    setBusy(false);
    hideProgress();
    setStatus(err instanceof Error ? err.message : String(err), 'err');
  });
}

sendBtn.addEventListener('click', () => {
  void requestClip('cloud');
});
downloadBtn.addEventListener('click', () => {
  void requestClip('download');
});

openReadestBtn.addEventListener('click', () => {
  chrome.tabs.create({ url: LOGIN_URL });
});

enableFileAccessBtn.addEventListener('click', () => {
  chrome.tabs.create({ url: extensionSettingsUrl() });
});

chrome.runtime.onMessage.addListener((message: unknown): void => {
  if (!message || typeof message !== 'object') return;
  const m = message as { type?: string; progress?: ClipProgress };
  if (m.type === 'send-to-readest:progress' && m.progress) {
    render(m.progress);
  }
});

init().catch((err: unknown) => {
  setStatus(err instanceof Error ? err.message : String(err), 'err');
});
