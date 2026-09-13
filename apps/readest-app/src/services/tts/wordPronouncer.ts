import { createReadingSpeechClient } from './createReadingSpeech';
import { ReadingSpeech } from './ReadingSpeech';
import { eventDispatcher } from '@/utils/event';
let session: ReadingSpeech | undefined;
let revision = 0;
export function cancelWordPronounce() {
  ++revision;
  const previous = session;
  session = undefined;
  if (previous) void previous.close();
}
export async function pronounceWord(
  text: string,
  lang: string | undefined,
  _env: unknown,
  update: (status: string) => void,
) {
  cancelWordPronounce();
  const current = revision;
  eventDispatcher.dispatch('tts-stop', {});
  try {
    const client = await createReadingSpeechClient();
    if (current !== revision) return;
    session = new ReadingSpeech(client, (state) => {
      if (current === revision) update(state);
    });
    await session.readText(text, lang || '', 1, '');
  } catch {
    if (current === revision) update('error');
  }
}
