import type { FoliateView } from '@/types/view';
import { createTTSNodeFilter } from './nodeFilter';
import type { TTSVoice } from './types';
import type { TTSClient } from './TTSClient';

export type SpeechState = 'idle' | 'loading' | 'playing' | 'paused' | 'finished' | 'error';
export const speechTextSSML = (text: string) =>
  `<speak xmlns="http://www.w3.org/2001/10/synthesis"><mark name="selection"/>${text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</speak>`;

/** A reading session reuses foliate's paragraph/mark iterator and the platform engines. */
export class ReadingSpeech {
  private request?: AbortController;
  private generation = 0;
  private restart?: () => Promise<void>;
  private restartAfterPause = false;
  constructor(
    public client: TTSClient,
    private update: (state: SpeechState) => void,
    private onVoices?: (voices: TTSVoice[]) => void,
  ) {}

  private async begin(lang: string, rate: number, voice: string) {
    const generation = ++this.generation;
    this.request?.abort();
    const request = new AbortController();
    this.request = request;
    this.update('loading');
    await this.client.stop();
    if (generation !== this.generation) return null;
    const ready = await this.client.init();
    if (generation !== this.generation) return null;
    if (!ready) throw new Error('Speech unavailable');
    this.onVoices?.(await this.client.getAllVoices());
    if (request.signal.aborted) return null;
    this.client.setPrimaryLang(lang);
    await this.client.setRate(rate);
    await this.client.setVoice(voice);
    return request.signal.aborted ? null : request.signal;
  }

  private async speak(ssml: string, signal: AbortSignal, view?: FoliateView) {
    if (signal.aborted) return;
    this.update('playing');
    for await (const event of this.client.speak(ssml, signal)) {
      if (signal.aborted) return;
      if (event.code === 'error') throw new Error('Speech failed');
      if (event.code === 'boundary' && event.mark) view?.tts?.setMark(event.mark);
    }
  }

  async readText(text: string, lang: string, rate: number, voice: string) {
    this.restart = () => this.readText(text, lang, rate, voice);
    const generation = this.generation + 1;
    try {
      const signal = await this.begin(lang, rate, voice);
      if (!signal) return;
      if (text.trim()) await this.speak(speechTextSSML(text), signal);
      if (!signal.aborted) this.update('finished');
    } catch {
      if (generation === this.generation) this.update('error');
    }
  }

  async readView(view: FoliateView, lang: string, rate: number, voice: string) {
    this.restart = () => this.readView(view, lang, rate, voice);
    const generation = this.generation + 1;
    try {
      const signal = await this.begin(lang, rate, voice);
      if (!signal) return;
      await view.initTTS('sentence', createTTSNodeFilter());
      if (signal.aborted) return;
      const range = view.lastLocation?.range;
      let ssml = range ? view.tts?.from(range) : view.tts?.start();
      let sectionIndex = view.renderer.primaryIndex;
      while (!signal.aborted) {
        if (ssml) {
          await this.speak(ssml, signal, view);
          if (signal.aborted) return;
          ssml = view.tts?.next();
        } else {
          const index = ++sectionIndex;
          if (index >= view.book.sections.length) break;
          if (view.book.sections[index]?.linear === 'no') continue;
          await view.goTo(index);
          if (signal.aborted) return;
          if (view.renderer.primaryIndex !== index) throw new Error('Section unavailable');
          await view.initTTS('sentence', createTTSNodeFilter());
          if (signal.aborted) return;
          ssml = view.tts?.start();
        }
      }
      if (!signal.aborted) this.update('finished');
    } catch {
      if (generation === this.generation) this.update('error');
    }
  }
  async pause() {
    const generation = this.generation;
    try {
      this.restartAfterPause = !(await this.client.pause());
      if (generation !== this.generation) return;
      if (this.restartAfterPause) {
        ++this.generation;
        this.request?.abort();
      }
      this.update('paused');
    } catch {
      if (generation === this.generation) this.update('error');
    }
  }
  async resume() {
    const generation = this.generation;
    try {
      if (this.restartAfterPause) {
        this.restartAfterPause = false;
        await this.restart?.();
      } else {
        await this.client.resume();
        if (generation === this.generation) this.update('playing');
      }
    } catch {
      if (generation === this.generation) this.update('error');
    }
  }
  async close() {
    ++this.generation;
    this.request?.abort();
    this.update('idle');
    try {
      await this.client.shutdown();
    } catch {
      /* The session is already cancelled. */
    }
  }
}
