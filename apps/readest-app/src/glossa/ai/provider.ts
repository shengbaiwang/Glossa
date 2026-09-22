import { md5 } from 'js-md5';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { isTauriAppPlatform } from '@/services/environment';
import { clearSecureItem, getSecureItem, setSecureItem } from '@/utils/bridge';
import { stubTranslation as _ } from '@/utils/misc';
import { readProviderCost, readTokenUsage, type CompletionMetrics } from './usage';

export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export const REASONING_EFFORTS: readonly ReasoningEffort[] = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
];

export interface ProviderConfig {
  id: string;
  name: string;
  /** OpenAI-compatible API base, including /v1 when the service requires it. */
  baseUrl: string;
  model: string;
  /** Only sent when the service and model are known to accept it. */
  reasoningEffort?: ReasoningEffort;
  /** Preferred output cap in tokens for conversation replies. */
  maxTokens?: number;
}

export interface ProviderCapabilities {
  /** Effort levels this service/model accepts; empty when unsupported. */
  reasoningEfforts: ReasoningEffort[];
  /** Sent when no explicit effort is chosen. */
  defaultReasoningEffort?: ReasoningEffort;
  maxTokensParam: 'max_tokens' | 'max_completion_tokens';
}

/** Keep capabilities in one place so no request sends a guessed vendor parameter. */
export function providerCapabilities(config: ProviderConfig): ProviderCapabilities {
  let host = '';
  try {
    host = new URL(config.baseUrl).hostname;
  } catch {
    host = '';
  }
  // GLM-5.3 requires thinking and supports low/high/max.
  // https://docs.z.ai/guides/capabilities/thinking
  if (
    ['open.bigmodel.cn', 'api.z.ai'].includes(host) &&
    /^glm-5\.3(?:-flash)?$/i.test(config.model)
  ) {
    return {
      reasoningEfforts: ['low', 'high', 'max'],
      defaultReasoningEffort: 'low',
      maxTokensParam: 'max_tokens',
    };
  }
  // Match verified model families and dated snapshots, never arbitrary suffixes
  // (chat-latest, pro and codex variants have different API capabilities).
  // https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5.2
  if (host === 'api.openai.com') {
    const model = config.model.toLowerCase().replace(/-\d{4}-\d{2}-\d{2}$/, '');
    let reasoningEfforts: ReasoningEffort[] = [];
    if (['gpt-5', 'gpt-5-mini', 'gpt-5-nano'].includes(model))
      reasoningEfforts = ['minimal', 'low', 'medium', 'high'];
    else if (model === 'gpt-5.1') reasoningEfforts = ['none', 'low', 'medium', 'high'];
    else if (model === 'gpt-5.2') reasoningEfforts = ['none', 'low', 'medium', 'high', 'xhigh'];
    else if (['o1', 'o3', 'o3-mini', 'o4-mini'].includes(model))
      reasoningEfforts = ['low', 'medium', 'high'];
    return { reasoningEfforts, maxTokensParam: 'max_completion_tokens' };
  }
  return { reasoningEfforts: [], maxTokensParam: 'max_tokens' };
}

/** The plain identity stored with each reply; never persist capability fields. */
export function providerIdentity(config: ProviderConfig): ProviderConfig {
  const { id, name, baseUrl, model } = config;
  return { id, name, baseUrl, model };
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
  onMetrics?: (metrics: CompletionMetrics) => void;
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    strict?: boolean;
  };
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export type ToolCompletionMessage =
  | CompletionMessage
  | { role: 'assistant'; content: string | null; tool_calls: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface ToolCompletionRequest extends Omit<CompletionRequest, 'messages'> {
  messages: ToolCompletionMessage[];
  tools: ToolDefinition[];
  toolChoice?: 'auto' | 'none';
}

export interface ToolCompletionResult {
  text: string;
  toolCalls: ToolCall[];
}

export const MODEL_SETTINGS_EVENT = 'glossa-model-settings-changed';
const STORAGE_KEY = 'glossa.study-models.v1';
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_TOOL_CALLS = 8;
const MAX_TOOL_ARGUMENT_CHARS = 8192;
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
    public readonly code: 'length' | 'service' | 'unsupported_tools' = 'service',
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
  const reasoningEffort = value['reasoningEffort'];
  if (reasoningEffort !== undefined && !REASONING_EFFORTS.includes(reasoningEffort as never)) {
    throw new ModelServiceError(_('The model settings are invalid.'));
  }
  const maxTokens = value['maxTokens'];
  if (
    maxTokens !== undefined &&
    (typeof maxTokens !== 'number' ||
      !Number.isInteger(maxTokens) ||
      maxTokens < 1 ||
      maxTokens > 65536)
  ) {
    throw new ModelServiceError(_('The model settings are invalid.'));
  }
  // Explicit field selection prevents accidental key persistence from a form object.
  return {
    id: value['id'],
    name: value['name'].trim(),
    baseUrl: normalizeBaseUrl(value['baseUrl']),
    model: value['model'].trim(),
    ...(reasoningEffort ? { reasoningEffort: reasoningEffort as ReasoningEffort } : {}),
    ...(maxTokens !== undefined ? { maxTokens: maxTokens as number } : {}),
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
  toolRequest = false,
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
    if (
      (toolRequest || (isRecord(body) && body['stream_options'])) &&
      [400, 422].includes(response.status)
    ) {
      const rejected = await rejectedOptionalParameter(response, signal);
      if (rejected === 'usage' && isRecord(body) && body['stream_options']) {
        const { stream_options: _usage, ...withoutUsage } = body;
        return request(config, path, signal, withoutUsage, toolRequest);
      }
      if (rejected === 'tools' && toolRequest)
        throw new ModelServiceError(
          _('This model service does not support reading tools.'),
          'unsupported_tools',
        );
    }
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
  maxBytes = MAX_RESPONSE_BYTES,
  stop?: AbortSignal,
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
  stop?.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      checkAbort(signal);
      const { done, value } = await reader.read();
      checkAbort(signal);
      if (done) break;
      bytes += value['byteLength'];
      if (bytes > maxBytes)
        throw new ModelServiceError(_('The model response is too large. Try a smaller chapter.'));
      if (onText(decoder.decode(value, { stream: true })) === false) break;
    }
    onText(decoder.decode());
  } finally {
    signal?.removeEventListener('abort', cancel);
    stop?.removeEventListener('abort', cancel);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Inspect only bounded JSON error metadata; never expose the server's message. */
async function rejectedOptionalParameter(
  response: Response,
  signal?: AbortSignal,
): Promise<'tools' | 'usage' | undefined> {
  try {
    let body = '';
    await consumeText(
      response,
      signal,
      (part) => {
        body += part;
      },
      16384,
    );
    const value = parseJson(body);
    const error = isRecord(value) && isRecord(value['error']) ? value['error'] : value;
    if (!isRecord(error) || typeof error['message'] !== 'string') return;
    const message = error['message'];
    // Invalid schemas, context overflow and unrelated unsupported parameters must
    // remain errors rather than silently triggering a second model request.
    if (
      /\b(?:tools?|tool_choice|function[ _-]calling)\b["'`\s:]*(?:(?:is|are)\s+)?(?:not supported|unsupported)\b/i.test(
        message,
      ) ||
      /\b(?:does not support|doesn't support|cannot support)\s+(?:the\s+)?["'`]?(?:tools?|tool_choice|function[ _-]calling)\b/i.test(
        message,
      ) ||
      /\b(?:unknown|unrecognized|unsupported)\s+(?:parameter|argument)\s*:?\s*["'`]?(?:tools?|tool_choice)\b/i.test(
        message,
      )
    )
      return 'tools';
    if (
      /\b(?:stream_options|include_usage)\b["'`\s:]*(?:(?:is|are)\s+)?(?:not supported|unsupported|not permitted)\b/i.test(
        message,
      ) ||
      /\b(?:unknown|unrecognized|unsupported)\s+(?:parameter|argument)\s*:?\s*["'`]?(?:stream_options|include_usage)\b/i.test(
        message,
      )
    )
      return 'usage';
    return;
  } catch (error) {
    checkAbort(signal);
    if (error instanceof Error && error.name === 'AbortError') throw error;
    return;
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

function invalidToolResponse(): ModelServiceError {
  return new ModelServiceError(_('The model service returned an invalid response.'));
}

function validateToolCall(value: unknown, names: Set<string>): ToolCall {
  if (
    !isRecord(value) ||
    typeof value['id'] !== 'string' ||
    !value['id'] ||
    value['id'].length > 256 ||
    /\s/.test(value['id']) ||
    value['type'] !== 'function' ||
    !isRecord(value['function']) ||
    typeof value['function']['name'] !== 'string' ||
    !names.has(value['function']['name']) ||
    typeof value['function']['arguments'] !== 'string' ||
    value['function']['arguments'].length > MAX_TOOL_ARGUMENT_CHARS ||
    !isRecord(parseJson(value['function']['arguments']))
  )
    throw invalidToolResponse();
  return {
    id: value['id'],
    type: 'function',
    function: { name: value['function']['name'], arguments: value['function']['arguments'] },
  };
}

function validateToolRequest({ messages, tools, toolChoice }: ToolCompletionRequest): Set<string> {
  const invalid = () => new ModelServiceError(_('The model request is invalid.'));
  if (
    !Array.isArray(tools) ||
    !tools.length ||
    tools.length > 16 ||
    (toolChoice !== undefined && !['auto', 'none'].includes(toolChoice))
  )
    throw invalid();
  const names = new Set<string>();
  for (const tool of tools) {
    if (
      !isRecord(tool) ||
      tool['type'] !== 'function' ||
      !isRecord(tool['function']) ||
      typeof tool['function']['name'] !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,64}$/.test(tool['function']['name']) ||
      names.has(tool['function']['name']) ||
      typeof tool['function']['description'] !== 'string' ||
      tool['function']['description'].length > 4096 ||
      !isRecord(tool['function']['parameters']) ||
      tool['function']['parameters']['type'] !== 'object' ||
      (tool['function']['strict'] !== undefined && typeof tool['function']['strict'] !== 'boolean')
    )
      throw invalid();
    names.add(tool['function']['name']);
  }
  // Tool output must answer an outstanding call from the immediately preceding
  // assistant message. Do not send orphaned or partially answered transcripts.
  const pending = new Set<string>();
  if (!Array.isArray(messages) || !messages.length) throw invalid();
  for (const message of messages) {
    if (!isRecord(message)) throw invalid();
    if (message['role'] === 'tool') {
      if (
        typeof message['content'] !== 'string' ||
        typeof message['tool_call_id'] !== 'string' ||
        !pending.delete(message['tool_call_id'])
      )
        throw invalid();
      continue;
    }
    if (pending.size || !['system', 'user', 'assistant'].includes(message['role'] as string))
      throw invalid();
    if ('tool_calls' in message) {
      if (
        message['role'] !== 'assistant' ||
        (message['content'] !== null && typeof message['content'] !== 'string') ||
        !Array.isArray(message['tool_calls']) ||
        !message['tool_calls'].length ||
        message['tool_calls'].length > MAX_TOOL_CALLS
      )
        throw invalid();
      for (const value of message['tool_calls']) {
        let call: ToolCall;
        try {
          call = validateToolCall(value, names);
        } catch {
          throw invalid();
        }
        if (pending.has(call.id)) throw invalid();
        pending.add(call.id);
      }
    } else if (typeof message['content'] !== 'string') throw invalid();
  }
  if (pending.size) throw invalid();
  return names;
}

export async function streamCompletion(request: CompletionRequest): Promise<string> {
  return (await streamModelCompletion(request)).text;
}

/** Transport only: callers enforce per-tool argument schemas and execution scope. */
export async function streamToolCompletion(
  request: ToolCompletionRequest,
): Promise<ToolCompletionResult> {
  const names = validateToolRequest(request);
  return streamModelCompletion(request, {
    tools: request.tools,
    toolChoice: request.toolChoice ?? 'auto',
    names,
  });
}

async function streamModelCompletion(
  {
    config: input = getActiveProviderConfig() ?? undefined,
    messages,
    signal,
    onDelta,
    maxTokens,
    onMetrics,
  }: Omit<CompletionRequest, 'messages'> & { messages: ToolCompletionMessage[] },
  toolSettings?: {
    tools: ToolDefinition[];
    toolChoice: 'auto' | 'none';
    names: Set<string>;
  },
): Promise<ToolCompletionResult> {
  if (!input) throw new ModelServiceError(_('Configure a model service first.'));
  const config = validateProviderConfig(input);
  if (!config.model) throw new ModelServiceError(_('Enter a model name first.'));
  const capabilities = providerCapabilities(config);
  const budget = maxTokens ?? config.maxTokens ?? 6000;
  if (
    !messages.length ||
    (!toolSettings &&
      messages.some(
        (message) =>
          !['system', 'user', 'assistant'].includes(message['role']) ||
          typeof message['content'] !== 'string',
      )) ||
    !Number.isInteger(budget) ||
    budget < 1 ||
    budget > 65536
  ) {
    throw new ModelServiceError(_('The model request is invalid.'));
  }
  // A stored effort is only sent when the current service/model accepts it.
  const reasoningEffort =
    config.reasoningEffort && capabilities.reasoningEfforts.includes(config.reasoningEffort)
      ? config.reasoningEffort
      : capabilities.defaultReasoningEffort;
  const started = performance.now();
  const metrics: CompletionMetrics = {
    id: crypto.randomUUID(),
    outputBudget: budget,
    elapsedMs: 0,
    finished: false,
  };
  const report = () => onMetrics?.({ ...metrics, elapsedMs: performance.now() - started });
  const trailer = new AbortController();
  let trailerTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    checkAbort(signal);
    report();
    const response = await request(
      config,
      'chat/completions',
      signal,
      {
        model: config.model,
        messages,
        stream: true,
        ...(onMetrics ? { stream_options: { include_usage: true } } : {}),
        [capabilities.maxTokensParam]: budget,
        ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
        ...(toolSettings
          ? { tools: toolSettings.tools, tool_choice: toolSettings.toolChoice }
          : {}),
      },
      !!toolSettings,
    );
    let output = '';
    let buffer = '';
    let finished = false;
    let done = false;
    let truncated = false;
    const collectUsage = (value: unknown) => {
      if (!isRecord(value)) return;
      const usage = readTokenUsage(value['usage']);
      const cost = readProviderCost(value['usage'], config.baseUrl);
      if (usage) metrics.usage = { ...metrics.usage, ...usage };
      if (cost) metrics.cost = cost;
      if (usage || cost) report();
    };
    const pendingCalls = new Map<
      number,
      { id?: string; type?: string; function: { name?: string; arguments: string } }
    >();
    const appendCalls = (value: unknown, streaming: boolean) => {
      if (value === undefined || value === null || !toolSettings) return;
      if (
        !Array.isArray(value) ||
        value.length > MAX_TOOL_CALLS ||
        (value.length && toolSettings.toolChoice === 'none')
      )
        throw invalidToolResponse();
      for (const [position, delta] of value.entries()) {
        if (!isRecord(delta)) throw invalidToolResponse();
        const index = streaming ? delta['index'] : position;
        if (
          typeof index !== 'number' ||
          !Number.isInteger(index) ||
          index < 0 ||
          index >= MAX_TOOL_CALLS
        )
          throw invalidToolResponse();
        const call = pendingCalls.get(index) ?? { function: { arguments: '' } };
        // id/type/name are metadata, not argument deltas; repeats must agree.
        for (const key of ['id', 'type'] as const) {
          const field = delta[key];
          if (field === undefined || field === null) continue;
          if (
            typeof field !== 'string' ||
            field.length > 256 ||
            (call[key] !== undefined && call[key] !== field)
          )
            throw invalidToolResponse();
          call[key] = field;
        }
        const fn = delta['function'];
        if (fn !== undefined && fn !== null) {
          if (!isRecord(fn)) throw invalidToolResponse();
          const name = fn['name'];
          if (name !== undefined && name !== null) {
            if (
              typeof name !== 'string' ||
              !toolSettings.names.has(name) ||
              (call.function.name !== undefined && call.function.name !== name)
            )
              throw invalidToolResponse();
            call.function.name = name;
          }
          const args = fn['arguments'];
          if (args !== undefined && args !== null) {
            if (typeof args !== 'string') throw invalidToolResponse();
            call.function.arguments += args;
            if (call.function.arguments.length > MAX_TOOL_ARGUMENT_CHARS)
              throw invalidToolResponse();
          }
        }
        pendingCalls.set(index, call);
      }
    };
    const append = (value: unknown) => {
      if (typeof value !== 'string') return;
      output += value;
      if (value) onDelta?.(value);
    };
    const consumeChoice = (value: unknown, streaming: boolean) => {
      collectUsage(value);
      const choice = responseChoices(value)[0];
      // Usage-only events have no choices.
      if (choice === undefined) return;
      if (!isRecord(choice))
        throw new ModelServiceError(_('The model service returned an invalid response.'));
      if (choice['finish_reason'] === 'content_filter')
        throw new ModelServiceError(_('The model service declined to generate these notes.'));
      const message = streaming ? choice['delta'] : choice['message'];
      if (isRecord(message)) {
        if (
          toolSettings &&
          message['content'] !== undefined &&
          message['content'] !== null &&
          typeof message['content'] !== 'string'
        )
          throw invalidToolResponse();
        append(message['content']);
        appendCalls(message['tool_calls'], streaming);
      }
      // A terminal event (and a non-streaming response) can contain useful text.
      // Publish it before reporting exhaustion so callers can retain/continue it.
      if (choice['finish_reason'] === 'length') truncated = true;
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
        done = true;
        return;
      }
      if (finished) {
        // Only usage may follow the terminal choice. Ignore malformed trailers,
        // later text and errors; they cannot alter the completed answer.
        try {
          collectUsage(JSON.parse(data));
        } catch {
          /* Optional metadata. */
        }
        return;
      }
      consumeChoice(parseJson(data), true);
      if (finished) {
        if (!onMetrics) done = true;
        else trailerTimer = setTimeout(() => trailer.abort(), 500);
      }
    };
    if (response.headers.get('content-type')?.toLowerCase().includes('text/event-stream')) {
      try {
        await consumeText(
          response,
          signal,
          (part) => {
            if (done) return false;
            buffer += part;
            let boundary = /\r?\n\r?\n/.exec(buffer);
            while (boundary) {
              event(buffer.slice(0, boundary.index));
              buffer = buffer.slice(boundary.index + boundary[0].length);
              if (done) return false;
              boundary = /\r?\n\r?\n/.exec(buffer);
            }
            return true;
          },
          MAX_RESPONSE_BYTES,
          trailer.signal,
        );
      } catch (error) {
        // Losing optional usage after a terminal choice does not lose the answer.
        if (!finished) throw error;
        checkAbort(signal);
      }
      if (!done && buffer.trim()) event(buffer);
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
    if (truncated)
      throw new ModelServiceError(
        _('The model response was cut short. Try a smaller chapter or another model.'),
        'length',
      );
    const toolCalls = [...pendingCalls]
      .sort(([left], [right]) => left - right)
      .map(([index, call], position) => {
        if (index !== position || !toolSettings) throw invalidToolResponse();
        return validateToolCall(call, toolSettings.names);
      });
    if (new Set(toolCalls.map((call) => call.id)).size !== toolCalls.length)
      throw invalidToolResponse();
    if (!output.trim() && !toolCalls.length)
      throw new ModelServiceError(_('The model service returned an empty response.'));
    return { text: output, toolCalls };
  } catch (error) {
    throw safeRequestError(error, signal);
  } finally {
    clearTimeout(trailerTimer);
    metrics.finished = true;
    report();
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
