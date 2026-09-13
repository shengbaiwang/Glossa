import { describe, expect, it, vi } from 'vitest';
import type { FoliateView } from '@/types/view';
import { ReadingSpeech } from '@/services/tts/ReadingSpeech';
import type { TTSClient } from '@/services/tts/TTSClient';

const client = () =>
  ({
    init: vi.fn(async () => true),
    stop: vi.fn(async () => {}),
    shutdown: vi.fn(async () => {}),
    setPrimaryLang: vi.fn(),
    setRate: vi.fn(async () => {}),
    setVoice: vi.fn(async () => {}),
    getAllVoices: vi.fn(async () => []),
    pause: vi.fn(async () => true),
    resume: vi.fn(async () => true),
    speak: vi.fn(async function* () {
      yield { code: 'end' as const };
    }),
  }) as unknown as TTSClient;

describe('reading speech lifecycle', () => {
  it('reads only selected text and completes without starting chapter playback', async () => {
    const engine = client();
    const updates = vi.fn();
    const speech = new ReadingSpeech(engine, updates);
    await speech.readText('a < b & c', 'en', 1, '');
    expect(engine.speak).toHaveBeenCalledTimes(1);
    expect(engine.speak).toHaveBeenCalledWith(
      expect.stringContaining('a &lt; b &amp; c'),
      expect.any(AbortSignal),
    );
    expect(updates).toHaveBeenLastCalledWith('finished');
  });
  it('ignores a late initialization after closing', async () => {
    const engine = client();
    const updates = vi.fn();
    let ready!: (value: boolean) => void;
    vi.mocked(engine.init).mockReturnValue(
      new Promise((resolve) => {
        ready = resolve;
      }),
    );
    const speech = new ReadingSpeech(engine, updates);
    const pending = speech.readText('selected', 'en', 1, '');
    await vi.waitFor(() => expect(engine.init).toHaveBeenCalled());
    await speech.close();
    ready(true);
    await pending;
    expect(engine.speak).not.toHaveBeenCalled();
    expect(updates).toHaveBeenLastCalledWith('idle');
  });
  it('reports unavailable engines and supports pause/resume', async () => {
    const engine = client();
    const updates = vi.fn();
    const speech = new ReadingSpeech(engine, updates);
    await speech.pause();
    await speech.resume();
    expect(engine.pause).toHaveBeenCalled();
    expect(engine.resume).toHaveBeenCalled();
    vi.mocked(engine.init).mockResolvedValue(false);
    await speech.readText('selected', 'en', 1, '');
    expect(updates).toHaveBeenLastCalledWith('error');
  });
  it('reports pause failures without leaving an unhandled rejection', async () => {
    const engine = client();
    const updates = vi.fn();
    vi.mocked(engine.pause).mockRejectedValue(new Error('unavailable'));
    await new ReadingSpeech(engine, updates).pause();
    expect(updates).toHaveBeenLastCalledWith('error');
  });
  it('starts at the visible range and continues to the next chapter', async () => {
    const engine = client();
    const updates = vi.fn();
    const range = document.createRange();
    const from = vi.fn(() => '<speak>current paragraph</speak>');
    const start = vi.fn(() => '<speak>next chapter</speak>');
    const view = {
      initTTS: vi.fn(),
      lastLocation: { range },
      renderer: { primaryIndex: 0 },
      book: { sections: [{}, {}] },
      tts: { from, start, next: vi.fn(), setMark: vi.fn() },
      goTo: vi.fn(async (index: number) => {
        view.renderer.primaryIndex = index;
      }),
    };
    const speech = new ReadingSpeech(engine, updates);
    await speech.readView(view as unknown as FoliateView, 'en', 1, '');
    expect(from).toHaveBeenCalledWith(range);
    expect(view.goTo).toHaveBeenCalledWith(1);
    expect(start).toHaveBeenCalledTimes(1);
    expect(engine.speak).toHaveBeenCalledTimes(2);
    expect(updates).toHaveBeenLastCalledWith('finished');
  });
});
