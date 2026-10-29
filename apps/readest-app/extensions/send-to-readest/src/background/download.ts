import { translate as _ } from '../lib/i18n';

/** EPUB bytes remain in the offscreen document; only its temporary URL crosses contexts. */
export async function downloadEpub(
  file: { url: string; filename: string },
  release: () => Promise<void>,
): Promise<void> {
  let downloadId: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const earlyStates = new Map<number, string>();
  let finish: (state: string) => void = () => undefined;
  const onChanged = (delta: chrome.downloads.DownloadDelta): void => {
    const state = delta.state?.current;
    if (state !== 'complete' && state !== 'interrupted') return;
    if (downloadId === undefined) earlyStates.set(delta.id, state);
    else if (delta.id === downloadId) finish(state);
  };
  chrome.downloads.onChanged.addListener(onChanged);
  try {
    const completion = new Promise<void>((resolve, reject) => {
      finish = (state): void => {
        if (state === 'complete') resolve();
        else reject(new Error(_('Download was interrupted. Try again.')));
      };
    });
    // A rejection can arrive while the download() promise is still resolving.
    void completion.catch(() => undefined);
    downloadId = await chrome.downloads.download({
      url: file.url,
      filename: file.filename,
      saveAs: true,
    });
    timer = setTimeout(() => finish('interrupted'), 5 * 60_000);
    const early = earlyStates.get(downloadId);
    if (early) finish(early);
    else {
      const [item] = await chrome.downloads.search({ id: downloadId });
      if (item?.state === 'complete' || item?.state === 'interrupted') finish(item.state);
    }
    await completion;
  } finally {
    if (timer) clearTimeout(timer);
    chrome.downloads.onChanged.removeListener(onChanged);
    await release().catch(() => undefined);
  }
}
