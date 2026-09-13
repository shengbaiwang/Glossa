import { useEffect, useRef, useState } from 'react';
import { Pause, Play, Volume, X } from '@/components/GlossaIcons';
import { useTranslation } from '@/hooks/useTranslation';
import { useReaderStore } from '@/store/readerStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useEnv } from '@/context/EnvContext';
import { saveViewSettings } from '@/helpers/settings';
import { eventDispatcher } from '@/utils/event';
import { ReadingSpeech, type SpeechState } from '@/services/tts/ReadingSpeech';
import { createReadingSpeechClient } from '@/services/tts/createReadingSpeech';
import { cancelWordPronounce } from '@/services/tts/wordPronouncer';
import type { TTSVoice } from '@/services/tts/types';

type SpeechRequest = { bookKey: string; text?: string };
export default function ReadingSpeechPlayer() {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const [request, setRequest] = useState<SpeechRequest | null>(null);
  const [state, setState] = useState<SpeechState>('idle');
  const [voices, setVoices] = useState<TTSVoice[]>([]);
  const [rate, setRate] = useState(1);
  const [voice, setVoice] = useState('');
  const session = useRef<ReadingSpeech | null>(null);
  const currentRequest = useRef(request);
  currentRequest.current = request;
  useEffect(() => {
    const start = (event: CustomEvent<SpeechRequest>) => {
      if (!event.detail?.bookKey) return;
      const settings = useReaderStore.getState().getViewSettings(event.detail.bookKey);
      setRate(settings?.ttsRate || 1);
      setVoice(settings?.ttsVoice || '');
      cancelWordPronounce();
      setRequest({ ...event.detail });
    };
    const stop = (event: CustomEvent<{ bookKey?: string }>) => {
      if (!event.detail?.bookKey || event.detail.bookKey === currentRequest.current?.bookKey)
        setRequest(null);
    };
    eventDispatcher.on('tts-start', start);
    eventDispatcher.on('tts-stop', stop);
    eventDispatcher.on('tts-close-book', stop);
    return () => {
      eventDispatcher.off('tts-start', start);
      eventDispatcher.off('tts-stop', stop);
      eventDispatcher.off('tts-close-book', stop);
    };
  }, []);
  useEffect(() => {
    if (!request) return;
    let cancelled = false;
    let active: ReadingSpeech | undefined;
    setState('loading');
    setVoices([]);
    void (async () => {
      const client = await createReadingSpeechClient();
      if (cancelled) return;
      active = new ReadingSpeech(
        client,
        (value) => {
          if (!cancelled) setState(value);
        },
        (items) => {
          if (!cancelled) setVoices(items);
        },
      );
      session.current = active;
      const data = useBookDataStore.getState().getBookData(request.bookKey);
      const lang = data?.book?.primaryLanguage || '';
      const view = useReaderStore.getState().getView(request.bookKey);
      const playing =
        request.text !== undefined
          ? active.readText(request.text, lang, rate, voice)
          : view
            ? active.readView(view, lang, rate, voice)
            : Promise.reject(new Error('No view'));
      await playing;
    })().catch(() => {
      if (!cancelled) setState('error');
    });
    return () => {
      cancelled = true;
      void active?.close();
      session.current = null;
    };
    // Rate/voice changes apply to the next sentence without restarting the reading position.
  }, [request]);
  if (!request) return null;
  const close = () => setRequest(null);
  return (
    <section className='glossa-speech-player eink-bordered' aria-label={_('Read Aloud')}>
      <Volume size={20} />
      <button
        className='glossa-icon-button touch-target'
        aria-label={state === 'playing' ? _('Pause') : _('Play')}
        disabled={state === 'loading'}
        onClick={() => {
          if (state === 'playing') void session.current?.pause();
          else if (state === 'paused') void session.current?.resume();
          else setRequest({ ...request });
        }}
      >
        {state === 'playing' ? <Pause size={20} /> : <Play size={20} />}
      </button>
      <select
        className='glossa-speech-voice'
        aria-label={_('Voice')}
        value={voice}
        onChange={(event) => {
          const value = event.target.value;
          setVoice(value);
          void session.current?.client.setVoice(value);
          void saveViewSettings(envConfig, request.bookKey, 'ttsVoice', value, false, false);
        }}
      >
        <option value=''>{_('System Voice')}</option>
        {voices.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </select>
      <select
        aria-label={_('Speed')}
        value={rate}
        onChange={(event) => {
          const value = Number(event.target.value);
          setRate(value);
          void session.current?.client.setRate(value);
          void saveViewSettings(envConfig, request.bookKey, 'ttsRate', value, false, false);
        }}
      >
        {[...new Set([0.75, 1, 1.25, 1.5, 1.75, 2, rate])]
          .sort((a, b) => a - b)
          .map((value) => (
            <option key={value} value={value}>
              {value}×
            </option>
          ))}
      </select>
      <button className='glossa-icon-button touch-target' aria-label={_('Close')} onClick={close}>
        <X size={18} />
      </button>
      <span className={state === 'error' ? 'glossa-speech-error' : 'sr-only'} role='status'>
        {state === 'error'
          ? _('Read aloud unavailable. Try again.')
          : state === 'loading'
            ? _('Loading...')
            : state === 'finished'
              ? _('Finished')
              : ''}
      </span>
    </section>
  );
}
