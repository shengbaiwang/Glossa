import { afterEach, expect, it, vi } from 'vitest';
import { WebSpeechClient } from '@/services/tts/WebSpeechClient';
afterEach(() => vi.unstubAllGlobals());
it('cancels a pending system utterance and never speaks the remaining marks', async () => {
  const synth = {
    getVoices: () => [{ name: 'Test', voiceURI: 'test', lang: 'en' }],
    speak: vi.fn(),
    cancel: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal('speechSynthesis', synth);
  vi.stubGlobal(
    'SpeechSynthesisUtterance',
    class {
      text = '';
      voice = null;
      rate = 1;
      pitch = 1;
      lang = '';
      onend = null;
      onerror = null;
    },
  );
  const client = new WebSpeechClient();
  expect(await client.init()).toBe(true);
  const abort = new AbortController();
  const pending = (async () => {
    for await (const _event of client.speak(
      '<speak xmlns="http://www.w3.org/2001/10/synthesis"><mark name="one"/>First.<mark name="two"/>Second.</speak>',
      abort.signal,
    )) {
      /* drain */
    }
  })();
  await vi.waitFor(() => expect(synth.speak).toHaveBeenCalledTimes(1));
  abort.abort();
  await pending;
  expect(synth.cancel).toHaveBeenCalled();
  expect(synth.speak).toHaveBeenCalledTimes(1);
});
