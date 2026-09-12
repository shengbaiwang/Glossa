import { md5 } from 'js-md5';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { isTauriAppPlatform } from '@/services/environment';
import { clearSecureItem, getSecureItem, setSecureItem } from '@/utils/bridge';
import { stubTranslation as _ } from '@/utils/misc';

export interface ProviderConfig {
  id: string;
  name: string;
  /** OpenAI-compatible API base, including /v1 when the service requires it. */
  baseUrl: string;
  model: string;
}

export interface CompletionMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompletionRequest {
  config?: ProviderConfig;
  messages: CompletionMessage[];
  signal?: AbortSignal;
  onDelta?: (delta: string) => void;
  maxTokens?: number;
}

export const MODEL_SETTINGS_EVENT = 'glossa-model-settings-changed';
const STORAGE_KEY = 'glossa.study-models.v1';
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
// Browser secrets deliberately live only in module memory, never in browser storage.
const sessionKeys = new Map<string, string>();

export const PROVIDER_PRESETS: readonly ProviderConfig[] = [
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: '' },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
  },
  { id: 'siliconflow', name: 'SiliconFlow', baseUrl: 'https://api.siliconflow.cn/v1', model: '' },
  { id: 'ollama', name: 'Ollama', baseUrl: 'http://localhost:11434/v1', model: '' },
  { id: 'custom', name: 'Custom service', baseUrl: '', model: '' },
];

export class ModelServiceError extends Error {
  constructor(
    message: string,
    public readonly code: 'length' | 'service' = 'service',
  ) {
    super(message);
    this.name = 'ModelServiceError';
  }
}

export function normalizeBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value['trim']());
  } catch {
    throw new ModelServiceError(_('Enter a valid API base URL.'));
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new ModelServiceError(
      _('Use HTTPS, or HTTP for a local service, without a key in the URL.'),
    );
  }
  url.pathname = url.pathname.replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
  return url.toString().replace(/\/+$/, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateProviderConfig(value: unknown): ProviderConfig {
  if (
    !isRecord(value) ||
    typeof value['id'] !== 'string' ||
    !/^[a-z0-9_-]{1,64}$/.test(value['id']) ||
    typeof value['name'] !== 'string' ||
    !value['name'].trim() ||
    value['name'].length > 120 ||
    typeof value['baseUrl'] !== 'string' ||
    value['baseUrl'].length > 2048 ||
    typeof value['model'] !== 'string' ||
    value['model'].length > 240 ||
    /[\r\n]/.test(value['model'])
  ) {
    throw new ModelServiceError(_('The model settings are invalid.'));
  }
  // Explicit field selection prevents accidental key persistence from a form object.
  return {
    id: value['id'],
    name: value['name'].trim(),
    baseUrl: normalizeBaseUrl(value['baseUrl']),
    model: value['model'].trim(),
  };
}

interface StoredProviders {
  activeId: string | null;
  providers: ProviderConfig[];
}

function readSettings(): StoredProviders {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (!isRecord(raw) || !Array.isArray(raw['providers'])) {
      return { activeId: null, providers: [] };
    }
    return {
      activeId: typeof raw['activeId'] === 'string' ? raw['activeId'] : null,
      providers: raw['providers'].map(validateProviderConfig),
    };
  } catch {
    return { activeId: null, providers: [] };
  }
}

export function getSavedProviderConfigs(): ProviderConfig[] {
  return readSettings().providers;
}

export function getActiveProviderConfig(): ProviderConfig | null {
  const settings = readSettings();
  return settings.providers.find((provider) => provider.id === settings.activeId) ?? null;
}

function secretKey(config: ProviderConfig): string {
  // Binding the key to the complete normalized endpoint prevents silently forwarding it
  // to a different host/path when a user edits a previously configured service.
  return `glossa.study-model.${config.id}.${md5(normalizeBaseUrl(config.baseUrl))}`;
}

async function readApiKey(config: ProviderConfig): Promise<string> {
  const key = secretKey(config);
  if (!isTauriAppPlatform()) return sessionKeys.get(key) ?? '';
  try {
    const result = await getSecureItem({ key });
    if (result.error) throw new Error();
    return result.value ?? '';
  } catch {
    throw new ModelServiceError(_('Unable to read the API key from secure storage.'));
  }
}

export async function saveProviderConfig(
  value: ProviderConfig,
  apiKey?: string,
): Promise<ProviderConfig> {
  const config = validateProviderConfig(value);
  if (apiKey !== undefined && apiKey.trim()) {
    const trimmedKey = apiKey.trim();
    if (trimmedKey.length > 4096 || /[\r\n]/.test(trimmedKey)) {
      throw new ModelServiceError(_('The API key is invalid.'));
    }
    if (isTauriAppPlatform()) {
      try {
        const result = await setSecureItem({ key: secretKey(config), value: trimmedKey });
        if (!result.success) throw new Error();
      } catch {
        throw new ModelServiceError(_('Unable to save the API key securely.'));
      }
    } else {
      sessionKeys.set(secretKey(config), trimmedKey);
    }
  }
  const settings = readSettings();
  settings.providers = [...settings.providers.filter((item) => item['id'] !== config.id), config];
  settings.activeId = config.id;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    throw new ModelServiceError(_('Unable to save model settings on this device.'));
  }
  window.dispatchEvent(new Event(MODEL_SETTINGS_EVENT));
  return config;
}

export async function clearProviderApiKey(config: ProviderConfig): Promise<void> {
  if (isTauriAppPlatform()) {
    try {
      const result = await clearSecureItem({ key: secretKey(config) });
      if (!result.success) throw new Error();
    } catch {
      throw new ModelServiceError(_('Unable to remove the API key from secure storage.'));
    }
  } else {
    sessionKeys.delete(secretKey(config));
  }
  window.dispatchEvent(new Event(MODEL_SETTINGS_EVENT));
}

export async function getProviderStatus(config = getActiveProviderConfig()) {
  const storage = isTauriAppPlatform() ? ('keychain' as const) : ('session' as const);
  if (!config) return { configured: false, hasApiKey: false, storage };
  const valid = validateProviderConfig(config);
  const hasApiKey = Boolean(await readApiKey(valid));
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(valid.baseUrl).hostname);
  return { configured: Boolean(valid.model && (hasApiKey || local)), hasApiKey, storage };
}

function abortError(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError');
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function safeRequestError(error: unknown, signal?: AbortSignal): Error {
  if (signal?.aborted || (error instanceof Error && error.name === 'AbortError'))
    return abortError();
  if (error instanceof ModelServiceError) return error;
  // Never expose an SDK/network/server error: it can contain keys or source text.
  return new ModelServiceError(
    _('Could not connect to the model service. Check the address and network.'),
  );
}

async function request(
  config: ProviderConfig,
  path: string,
  signal?: AbortSignal,
  body?: object,
): Promise<Response> {
  checkAbort(signal);
  const key = await readApiKey(config);
  checkAbort(signal);
  const headers = {
    'Content-Type': 'application/json',
    ...(key ? { Authorization: `Bearer ${key}` } : {}),
  };
  const options: RequestInit = {
    method: body ? 'POST' : 'GET',
    headers,
    signal,
    redirect: 'error',
    credentials: 'omit',
    ...(body ? { body: JSON.stringify(body) } : {}),
  };
  const url = `${normalizeBaseUrl(config.baseUrl)}/${path}`;
  let response: Response;
  try {
    response = isTauriAppPlatform()
      ? await tauriFetch(url, { ...options, maxRedirections: 0, connectTimeout: 20000 })
      : await globalThis.fetch(url, options);
  } catch (error) {
    throw safeRequestError(error, signal);
  }
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 401 || response.status === 403) {
      throw new ModelServiceError(
        _('The API key was rejected. Check the key and service address.'),
      );
    }
    if (response.status === 429)
      throw new ModelServiceError(
        _('The model service is busy or its quota has been reached. Try again later.'),
      );
    if (response.status === 404)
      throw new ModelServiceError(
        _('The API endpoint or model was not found. Check the service address and model name.'),
      );
    throw new ModelServiceError(
      _('The model service could not complete the request. Check its configuration and try again.'),
    );
  }
  return response;
}

async function consumeText(
  response: Response,
  signal: AbortSignal | undefined,
  onText: (text: string) => boolean | void,
): Promise<void> {
  if (!response.body)
    throw new ModelServiceError(_('The model service returned an empty response.'));
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      checkAbort(signal);
      const { done, value } = await reader.read();
      checkAbort(signal);
      if (done) break;
      bytes += value['byteLength'];
      if (bytes > MAX_RESPONSE_BYTES)
        throw new ModelServiceError(_('The model response is too large. Try a smaller chapter.'));
      if (onText(decoder.decode(value, { stream: true })) === false) break;
    }
    onText(decoder.decode());
  } finally {
    signal?.removeEventListener('abort', cancel);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new ModelServiceError(_('The model service returned an invalid response.'));
  }
}

function responseChoices(value: unknown): unknown[] {
  if (!isRecord(value) || 'error' in value || !Array.isArray(value['choices'])) {
    throw new ModelServiceError(_('The model service returned an invalid response.'));
  }
  return value['choices'];
}

export async function listProviderModels(
  value: ProviderConfig,
  signal?: AbortSignal,
): Promise<string[]> {
  const config = validateProviderConfig(value);
  try {
    const response = await request(config, 'models', signal);
    let text = '';
    await consumeText(response, signal, (part) => {
      text += part;
    });
    const data = parseJson(text);
    if (!isRecord(data) || !Array.isArray(data['data']))
      throw new ModelServiceError(
        _('The service did not return a model list. Enter a model name manually.'),
      );
    return [
      ...new Set(
        data['data'].flatMap((item: unknown) =>
          isRecord(item) &&
          typeof item['id'] === 'string' &&
          item['id'].trim() &&
          item['id'].length <= 240 &&
          !/[\r\n]/.test(item['id'])
            ? [item['id']]
            : [],
        ),
      ),
    ].sort();
  } catch (error) {
    throw safeRequestError(error, signal);
  }
}

export async function streamCompletion({
  config: input = getActiveProviderConfig() ?? undefined,
  messages,
  signal,
  onDelta,
  maxTokens = 6000,
}: CompletionRequest): Promise<string> {
  if (!input)
    throw new ModelServiceError(_('Configure a model service before generating a reading guide.'));
  const config = validateProviderConfig(input);
  if (!config.model) throw new ModelServiceError(_('Enter a model name first.'));
  if (
    !messages.length ||
    messages.some(
      (message) =>
        !['system', 'user', 'assistant'].includes(message['role']) ||
        typeof message['content'] !== 'string',
    ) ||
    !Number.isInteger(maxTokens) ||
    maxTokens < 1 ||
    maxTokens > 65536
  ) {
    throw new ModelServiceError(_('The model request is invalid.'));
  }
  try {
    const response = await request(config, 'chat/completions', signal, {
      model: config.model,
      messages,
      stream: true,
      max_tokens: maxTokens,
      // GLM-5.3 requires thinking; low is its supported short-task setting.
      // Scope vendor parameters to verified official endpoints, never guessed relays.
      // https://docs.z.ai/guides/capabilities/thinking
      ...(['open.bigmodel.cn', 'api.z.ai'].includes(new URL(config.baseUrl).hostname) &&
      /^glm-5\.3(?:-flash)?$/i.test(config.model)
        ? { reasoning_effort: 'low' }
        : {}),
    });
    let output = '';
    let buffer = '';
    let finished = false;
    const append = (value: unknown) => {
      if (typeof value !== 'string') return;
      output += value;
      if (value) onDelta?.(value);
    };
    const consumeChoice = (value: unknown, streaming: boolean) => {
      const choice = responseChoices(value)[0];
      // Usage-only events have no choices.
      if (choice === undefined) return;
      if (!isRecord(choice))
        throw new ModelServiceError(_('The model service returned an invalid response.'));
      if (choice['finish_reason'] === 'length')
        throw new ModelServiceError(
          _('The model response was cut short. Try a smaller chapter or another model.'),
          'length',
        );
      if (choice['finish_reason'] === 'content_filter')
        throw new ModelServiceError(_('The model service declined to generate these notes.'));
      const message = streaming ? choice['delta'] : choice['message'];
      if (isRecord(message)) append(message['content']);
      if (typeof choice['finish_reason'] === 'string') finished = true;
    };
    const event = (value: string) => {
      const data = value['split'](/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');
      if (!data) return;
      if (data['trim']() === '[DONE]') {
        finished = true;
        return;
      }
      consumeChoice(parseJson(data), true);
    };
    if (response.headers.get('content-type')?.toLowerCase().includes('text/event-stream')) {
      await consumeText(response, signal, (part) => {
        if (finished) return false;
        buffer += part;
        let boundary = /\r?\n\r?\n/.exec(buffer);
        while (boundary) {
          event(buffer.slice(0, boundary.index));
          buffer = buffer.slice(boundary.index + boundary[0].length);
          // A terminal event may share a network chunk with a partial trailer.
          // The completed response ends here; do not parse or emit that trailer.
          if (finished) return false;
          boundary = /\r?\n\r?\n/.exec(buffer);
        }
        return true;
      });
      if (!finished && buffer.trim()) event(buffer);
      if (!finished)
        throw new ModelServiceError(
          _('The model connection ended before the response was complete. Try again.'),
        );
    } else {
      await consumeText(response, signal, (part) => {
        buffer += part;
      });
      consumeChoice(parseJson(buffer), false);
    }
    checkAbort(signal);
    if (!output.trim())
      throw new ModelServiceError(_('The model service returned an empty response.'));
    return output;
  } catch (error) {
    throw safeRequestError(error, signal);
  }
}

export async function testProviderConnection(
  config: ProviderConfig,
  signal?: AbortSignal,
): Promise<void> {
  await streamCompletion({
    config,
    signal,
    messages: [{ role: 'user', content: 'Reply with OK.' }],
    maxTokens: 32,
  });
}
