import { md5 } from 'js-md5';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { isTauriAppPlatform } from '@/services/environment';
import { clearSecureItem, getSecureItem, getSecureItemStatus, setSecureItem } from '@/utils/bridge';
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

export type ProviderPurpose = 'conversation' | 'mindmap';
export interface ProviderCapabilityOverrides {
  reasoningEfforts?: ReasoningEffort[];
  maxTokensParam?: 'max_tokens' | 'max_completion_tokens';
  tools?: boolean;
  json?: boolean;
}
export interface ProviderModelProfile {
  model: string;
  reasoningEffort?: ReasoningEffort;
  maxTokens?: number;
  capabilityOverrides?: ProviderCapabilityOverrides;
  favorite: boolean;
  lastUsedAt?: number;
}
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
  capabilityOverrides?: ProviderCapabilityOverrides;
}

export interface ProviderCapabilities {
  /** Effort levels this service/model accepts; empty when unsupported. */
  reasoningEfforts: ReasoningEffort[];
  /** Sent when no explicit effort is chosen. */
  defaultReasoningEffort?: ReasoningEffort;
  maxTokensParam: 'max_tokens' | 'max_completion_tokens';
  tools?: boolean;
  json?: boolean;
}

/** Keep capabilities in one place so no request sends a guessed vendor parameter. */
export function providerCapabilities(config: ProviderConfig): ProviderCapabilities {
  const known = inferredProviderCapabilities(config);
  const overrides = validateCapabilityOverrides(config.capabilityOverrides);
  if (!overrides) return known;
  const result = { ...known, ...overrides };
  if (
    result.defaultReasoningEffort &&
    !result.reasoningEfforts.includes(result.defaultReasoningEffort)
  )
    delete result.defaultReasoningEffort;
  return result;
}

function inferredProviderCapabilities(config: ProviderConfig): ProviderCapabilities {
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
  /** An explicitly entered draft credential; never persisted or included in diagnostics. */
  apiKeyOverride?: string;
  /** Opt-in for structured tasks; never imposed on ordinary conversations. */
  responseFormat?: { type: 'json_object' };
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
const LEGACY_STORAGE_KEY = 'glossa.study-models.v1';
export const MODEL_STORAGE_KEY = 'glossa.study-models.v2';
const STORAGE_KEY = MODEL_STORAGE_KEY;
const MODEL_CATALOG_KEY = 'glossa.study-model-catalog.v1';
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY || event.key === LEGACY_STORAGE_KEY || event.key === null)
      window.dispatchEvent(new Event(MODEL_SETTINGS_EVENT));
  });
}
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
    public readonly code:
      | 'length'
      | 'service'
      | 'unsupported_tools'
      | 'unsupported_format'
      | 'rate_limit' = 'service',
    public readonly retryAfterMs?: number,
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

function validateCapabilityOverrides(value: unknown): ProviderCapabilityOverrides | undefined {
  if (value === undefined) return;
  if (!isRecord(value)) throw new ModelServiceError(_('The model settings are invalid.'));
  const result: ProviderCapabilityOverrides = {};
  if (value['reasoningEfforts'] !== undefined) {
    if (
      !Array.isArray(value['reasoningEfforts']) ||
      value['reasoningEfforts'].some((item) => !REASONING_EFFORTS.includes(item))
    )
      throw new ModelServiceError(_('The model settings are invalid.'));
    result.reasoningEfforts = REASONING_EFFORTS.filter((effort) =>
      (value['reasoningEfforts'] as unknown[]).includes(effort),
    );
  }
  if (value['maxTokensParam'] !== undefined) {
    if (
      value['maxTokensParam'] !== 'max_tokens' &&
      value['maxTokensParam'] !== 'max_completion_tokens'
    )
      throw new ModelServiceError(_('The model settings are invalid.'));
    result.maxTokensParam = value['maxTokensParam'];
  }
  for (const field of ['tools', 'json'] as const) {
    if (value[field] !== undefined) {
      if (typeof value[field] !== 'boolean')
        throw new ModelServiceError(_('The model settings are invalid.'));
      result[field] = value[field];
    }
  }
  return Object.keys(result).length ? result : undefined;
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
  const capabilityOverrides = validateCapabilityOverrides(value['capabilityOverrides']);
  // Explicit field selection prevents accidental key persistence from a form object.
  return {
    id: value['id'],
    name: value['name'].trim(),
    baseUrl: normalizeBaseUrl(value['baseUrl']),
    model: value['model'].trim(),
    ...(reasoningEffort ? { reasoningEffort: reasoningEffort as ReasoningEffort } : {}),
    ...(maxTokens !== undefined ? { maxTokens: maxTokens as number } : {}),
    ...(capabilityOverrides ? { capabilityOverrides } : {}),
  };
}

interface ProviderConnection {
  revision: string;
  id: string;
  name: string;
  baseUrl: string;
  enabled: boolean;
  models: ProviderModelProfile[];
  lastModel: string;
}
interface StoredProviders {
  version: 2;
  connections: ProviderConnection[];
  defaults: Partial<Record<ProviderPurpose, { providerId: string; model: string }>>;
}
const emptySettings = (): StoredProviders => ({ version: 2, connections: [], defaults: {} });
function profileFromConfig(
  config: ProviderConfig,
  previous?: ProviderModelProfile,
): ProviderModelProfile {
  return {
    model: config.model,
    ...(config.reasoningEffort ? { reasoningEffort: config.reasoningEffort } : {}),
    ...(config.maxTokens !== undefined ? { maxTokens: config.maxTokens } : {}),
    ...(config.capabilityOverrides ? { capabilityOverrides: config.capabilityOverrides } : {}),
    favorite: previous?.favorite ?? false,
    ...(previous?.lastUsedAt ? { lastUsedAt: previous.lastUsedAt } : {}),
  };
}
function configFromConnection(
  connection: ProviderConnection,
  model = connection.lastModel,
): ProviderConfig {
  const profile = connection.models.find((item) => item.model === model);
  return validateProviderConfig({ ...connection, ...profile, model });
}
function readSettings(): StoredProviders {
  let raw: unknown;
  try {
    const current = localStorage.getItem(STORAGE_KEY);
    raw = JSON.parse(current ?? localStorage.getItem(LEGACY_STORAGE_KEY) ?? 'null');
  } catch {
    return emptySettings();
  }
  if (!isRecord(raw)) return emptySettings();
  const settings = emptySettings();
  if (raw['version'] === 2 && Array.isArray(raw['connections'])) {
    for (const value of raw['connections']) {
      try {
        if (!isRecord(value) || !Array.isArray(value['models'])) continue;
        const base = validateProviderConfig({ ...value, model: '' });
        const models: ProviderModelProfile[] = [];
        for (const entry of value['models']) {
          try {
            if (!isRecord(entry)) continue;
            const config = validateProviderConfig({ ...base, ...entry });
            if (!config.model || models.some((item) => item.model === config.model)) continue;
            models.push({
              ...profileFromConfig(config),
              favorite: entry['favorite'] === true,
              ...(typeof entry['lastUsedAt'] === 'number' && Number.isFinite(entry['lastUsedAt'])
                ? { lastUsedAt: entry['lastUsedAt'] }
                : {}),
            });
          } catch {
            /* One malformed model must not hide other saved connections. */
          }
        }
        settings.connections.push({
          revision: typeof value['revision'] === 'string' ? value['revision'] : 'initial',
          id: base.id,
          name: base.name,
          baseUrl: base.baseUrl,
          enabled: value['enabled'] !== false,
          models,
          lastModel:
            typeof value['lastModel'] === 'string' &&
            models.some((item) => item.model === value['lastModel'])
              ? value['lastModel']
              : (models[0]?.model ?? ''),
        });
      } catch {
        /* Keep unrelated valid connections available. */
      }
    }
    if (isRecord(raw['defaults'])) {
      for (const purpose of ['conversation', 'mindmap'] as const) {
        const selected = raw['defaults'][purpose];
        if (
          isRecord(selected) &&
          typeof selected['providerId'] === 'string' &&
          typeof selected['model'] === 'string'
        )
          settings.defaults[purpose] = {
            providerId: selected['providerId'],
            model: selected['model'],
          };
      }
    }
  } else if (Array.isArray(raw['providers'])) {
    for (const value of raw['providers']) {
      try {
        const config = validateProviderConfig(value);
        settings.connections.push({
          revision: 'legacy',
          id: config.id,
          name: config.name,
          baseUrl: config.baseUrl,
          enabled: true,
          models: config.model ? [profileFromConfig(config)] : [],
          lastModel: config.model,
        });
        if (config.id === raw['activeId']) {
          settings.defaults.conversation = { providerId: config.id, model: config.model };
          settings.defaults.mindmap = { providerId: config.id, model: config.model };
        }
      } catch {
        /* Preserve valid legacy entries and leave the original migration source intact. */
      }
    }
  }
  return settings;
}
function writeSettings(settings: StoredProviders) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    throw new ModelServiceError(_('Unable to save model settings on this device.'));
  }
  window.dispatchEvent(new Event(MODEL_SETTINGS_EVENT));
}
export function getSavedProviderConfigs(): ProviderConfig[] {
  return readSettings().connections.map((connection) => configFromConnection(connection));
}
export function isProviderEnabled(id: string): boolean {
  return readSettings().connections.find((item) => item.id === id)?.enabled ?? true;
}
export function getActiveProviderConfig(
  purpose: ProviderPurpose = 'conversation',
): ProviderConfig | null {
  const settings = readSettings();
  const selected = settings.defaults[purpose];
  const connection = settings.connections.find(
    (item) => item.id === selected?.providerId && item.enabled,
  );
  return connection && selected && connection.models.some((item) => item.model === selected.model)
    ? configFromConnection(connection, selected.model)
    : null;
}
export function getProviderModels(config: ProviderConfig): ProviderModelProfile[] {
  const connection = readSettings().connections.find(
    (item) => item.id === config.id && item.baseUrl === normalizeBaseUrl(config.baseUrl),
  );
  return connection?.models ?? [];
}
export function getProviderModelConfig(config: ProviderConfig, model: string): ProviderConfig {
  const profile = getProviderModels(config).find((item) => item.model === model);
  return validateProviderConfig({
    id: config.id,
    name: config.name,
    baseUrl: config.baseUrl,
    model,
    ...profile,
  });
}
export function setProviderEnabled(id: string, enabled: boolean): void {
  const settings = readSettings();
  const connection = settings.connections.find((item) => item.id === id);
  if (!connection) return;
  connection.enabled = enabled;
  connection.revision = crypto.randomUUID();
  writeSettings(settings);
}
export function setProviderModelFavorite(
  config: ProviderConfig,
  model: string,
  favorite: boolean,
): void {
  const settings = readSettings();
  const connection = settings.connections.find(
    (item) => item.id === config.id && item.baseUrl === normalizeBaseUrl(config.baseUrl),
  );
  if (!connection) return;
  let profile = connection.models.find((item) => item.model === model);
  if (!profile) {
    const valid = validateProviderConfig({
      id: config.id,
      name: config.name,
      baseUrl: config.baseUrl,
      model,
    });
    if (!valid.model) return;
    profile = profileFromConfig(valid);
    connection.models.push(profile);
  }
  profile.favorite = favorite;
  connection.revision = crypto.randomUUID();
  writeSettings(settings);
}
export function removeProviderModel(config: ProviderConfig, model: string): void {
  const settings = readSettings();
  const connection = settings.connections.find(
    (item) => item.id === config.id && item.baseUrl === normalizeBaseUrl(config.baseUrl),
  );
  if (!connection) return;
  connection.models = connection.models.filter((item) => item.model !== model);
  connection.revision = crypto.randomUUID();
  if (connection.lastModel === model) connection.lastModel = connection.models[0]?.model ?? '';
  for (const purpose of ['conversation', 'mindmap'] as const)
    if (
      settings.defaults[purpose]?.providerId === config.id &&
      settings.defaults[purpose]?.model === model
    )
      delete settings.defaults[purpose];
  writeSettings(settings);
}
export async function activateProviderConfig(
  config: ProviderConfig,
  purpose: ProviderPurpose = 'conversation',
): Promise<ProviderConfig> {
  const input = validateProviderConfig(config);
  if (!input.model) throw new ModelServiceError(_('Enter a model name first.'));
  if (!isProviderEnabled(input.id))
    throw new ModelServiceError(_('Enable this model service first.'));
  const valid = await saveProviderConfig(input);
  const settings = readSettings();
  const connection = settings.connections.find((item) => item.id === valid.id);
  if (
    !connection ||
    !connection.models.some((item) => item.model === valid.model) ||
    JSON.stringify(configFromConnection(connection, valid.model)) !== JSON.stringify(valid)
  )
    throw new ModelServiceError(_('The model settings changed. Reload them and try again.'));
  if (!connection.enabled) throw new ModelServiceError(_('Enable this model service first.'));
  settings.defaults[purpose] = { providerId: valid.id, model: valid.model };
  const profile = connection.models.find((item) => item.model === valid.model)!;
  profile.lastUsedAt = Date.now();
  connection.revision = crypto.randomUUID();
  writeSettings(settings);
  return valid;
}
export async function deleteProviderConfig(config: ProviderConfig): Promise<void> {
  const settings = readSettings();
  const connection = settings.connections.find((item) => item.id === config.id);
  if (!connection) return;
  if (connection.baseUrl !== normalizeBaseUrl(config.baseUrl))
    throw new ModelServiceError(_('The model settings changed. Reload them and try again.'));
  const expected = JSON.stringify(connection);
  await clearProviderApiKey(config);
  // Re-read after asynchronous secure storage access; preserve unrelated concurrent edits.
  const latest = readSettings();
  const current = latest.connections.find((item) => item.id === config.id);
  if (!current || JSON.stringify(current) !== expected)
    throw new ModelServiceError(_('The model settings changed. Reload them and try again.'));
  latest.connections = latest.connections.filter((item) => item.id !== config.id);
  for (const purpose of ['conversation', 'mindmap'] as const)
    if (latest.defaults[purpose]?.providerId === config.id) delete latest.defaults[purpose];
  writeSettings(latest);
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
  let connection = settings.connections.find((item) => item.id === config.id);
  if (!connection) {
    connection = {
      revision: crypto.randomUUID(),
      id: config.id,
      name: config.name,
      baseUrl: config.baseUrl,
      enabled: true,
      models: [],
      lastModel: '',
    };
    settings.connections.push(connection);
  }
  // Capability and catalog metadata belongs to the endpoint that declared it.
  if (connection.baseUrl !== config.baseUrl) connection.models = [];
  connection.revision = crypto.randomUUID();
  connection.name = config.name;
  connection.baseUrl = config.baseUrl;
  connection.lastModel = config.model;
  if (config.model) {
    const previous = connection.models.find((item) => item.model === config.model);
    connection.models = [
      ...connection.models.filter((item) => item.model !== config.model),
      profileFromConfig(config, previous),
    ];
  }
  writeSettings(settings);
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
  if (!config)
    return { configured: false, hasApiKey: false, storage, credentialStatus: 'missing' as const };
  const valid = validateProviderConfig(config);
  let credentialStatus: 'present' | 'missing' | 'unavailable' = 'unavailable';
  if (!isTauriAppPlatform())
    credentialStatus = sessionKeys.has(secretKey(valid)) ? 'present' : 'missing';
  else {
    try {
      const result = await getSecureItemStatus({ key: secretKey(valid) });
      if (
        result.status === 'present' ||
        result.status === 'missing' ||
        result.status === 'unavailable'
      )
        credentialStatus = result.status;
    } catch {
      /* A locked or unsupported keychain is not a missing credential. */
    }
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(valid.baseUrl).hostname);
  return {
    // Metadata never grants access: request() still obtains the credential on explicit use.
    configured: Boolean(
      valid.model && isProviderEnabled(valid.id) && (credentialStatus !== 'missing' || local),
    ),
    hasApiKey: credentialStatus === 'present',
    storage,
    credentialStatus,
  };
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
  apiKeyOverride?: string,
): Promise<Response> {
  checkAbort(signal);
  if (!isProviderEnabled(config.id))
    throw new ModelServiceError(_('Enable this model service first.'));
  const key = apiKeyOverride === undefined ? await readApiKey(config) : apiKeyOverride.trim();
  if (key.length > 4096 || /[\r\n]/.test(key))
    throw new ModelServiceError(_('The API key is invalid.'));
  if (!key && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(config.baseUrl).hostname))
    throw new ModelServiceError(_('Enter an API key for this model service.'));
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
      (toolRequest || (isRecord(body) && (body['stream_options'] || body['response_format']))) &&
      [400, 422].includes(response.status)
    ) {
      const rejected = await rejectedOptionalParameter(response, signal);
      if (rejected === 'format' && isRecord(body) && body['response_format'])
        throw new ModelServiceError(
          _('This model service does not support JSON output.'),
          'unsupported_format',
        );
      if (rejected === 'usage' && isRecord(body) && body['stream_options']) {
        const { stream_options: _usage, ...withoutUsage } = body;
        return request(config, path, signal, withoutUsage, toolRequest, apiKeyOverride);
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
    if (response.status === 429) {
      const header = response.headers.get('Retry-After');
      const delay =
        header === null
          ? 1000
          : /^\d+(?:\.\d+)?$/.test(header.trim())
            ? Number(header) * 1000
            : Date.parse(header) - Date.now();
      throw new ModelServiceError(
        _('The model service is busy or its quota has been reached. Try again later.'),
        'rate_limit',
        Number.isFinite(delay) ? Math.max(1000, delay) : 1000,
      );
    }
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
): Promise<'tools' | 'usage' | 'format' | undefined> {
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
    if (
      /\b(?:response_format|json_object|json mode)\b["'`\s:]*(?:(?:is|are)\s+)?(?:not supported|unsupported)\b/i.test(
        message,
      ) ||
      /\b(?:does not support|doesn't support)\s+(?:the\s+)?["'`]?(?:response_format|json_object|json mode)\b/i.test(
        message,
      ) ||
      /\b(?:unknown|unrecognized|unsupported)\s+(?:parameter|argument)\s*:?\s*["'`]?(?:response_format)\b/i.test(
        message,
      )
    )
      return 'format';
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

export interface ProviderModelCatalog {
  models: string[];
  updatedAt: number;
}
function catalogId(config: ProviderConfig): string {
  return `${config.id}:${normalizeBaseUrl(config.baseUrl)}`;
}
function readCatalogs(): Record<string, ProviderModelCatalog> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(MODEL_CATALOG_KEY) ?? '{}');
    if (!isRecord(value)) return {};
    const valid: Record<string, ProviderModelCatalog> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (
        !isRecord(entry) ||
        !Array.isArray(entry['models']) ||
        typeof entry['updatedAt'] !== 'number' ||
        !Number.isFinite(entry['updatedAt'])
      )
        continue;
      valid[key] = {
        updatedAt: entry['updatedAt'],
        models: entry['models']
          .filter(
            (model): model is string =>
              typeof model === 'string' &&
              !!model.trim() &&
              model.length <= 240 &&
              !/[\r\n]/.test(model),
          )
          .slice(0, 2048),
      };
    }
    return valid;
  } catch {
    return {};
  }
}
export function getCachedProviderModels(config: ProviderConfig): ProviderModelCatalog | null {
  try {
    return readCatalogs()[catalogId(config)] ?? null;
  } catch {
    return null;
  }
}
function cacheProviderModels(config: ProviderConfig, models: string[]) {
  const catalogs = readCatalogs();
  catalogs[catalogId(config)] = { models: models.slice(0, 2048), updatedAt: Date.now() };
  const bounded = Object.fromEntries(
    Object.entries(catalogs)
      .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
      .slice(0, 64),
  );
  try {
    localStorage.setItem(MODEL_CATALOG_KEY, JSON.stringify(bounded));
  } catch {
    /* Discovery succeeds even if its optional cache is full. */
  }
}

export async function listProviderModels(
  value: ProviderConfig,
  signal?: AbortSignal,
  options: { apiKey?: string; cache?: boolean } = {},
): Promise<string[]> {
  const config = validateProviderConfig(value);
  try {
    const response = await request(config, 'models', signal, undefined, false, options.apiKey);
    let text = '';
    await consumeText(response, signal, (part) => {
      text += part;
    });
    const data = parseJson(text);
    if (!isRecord(data) || !Array.isArray(data['data']))
      throw new ModelServiceError(
        _('The service did not return a model list. Enter a model name manually.'),
      );
    const models = [
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
    checkAbort(signal);
    if (options.cache !== false) cacheProviderModels(config, models);
    return models;
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
    responseFormat,
    apiKeyOverride,
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
  if (toolSettings && capabilities.tools === false)
    throw new ModelServiceError(
      _('This model service does not support reading tools.'),
      'unsupported_tools',
    );
  if (responseFormat && capabilities.json === false)
    throw new ModelServiceError(
      _('This model service does not support JSON output.'),
      'unsupported_format',
    );
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
    budget > 65536 ||
    (responseFormat !== undefined &&
      (!isRecord(responseFormat) ||
        responseFormat['type'] !== 'json_object' ||
        Object.keys(responseFormat).length !== 1))
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
        ...(responseFormat ? { response_format: responseFormat } : {}),
        ...(toolSettings
          ? { tools: toolSettings.tools, tool_choice: toolSettings.toolChoice }
          : {}),
      },
      !!toolSettings,
      apiKeyOverride,
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
  apiKey?: string,
): Promise<{ checked: 'chat'; elapsedMs: number }> {
  const started = performance.now();
  await streamCompletion({
    config,
    signal,
    apiKeyOverride: apiKey,
    messages: [{ role: 'user', content: 'Reply with OK.' }],
    maxTokens: 512,
  });
  return { checked: 'chat', elapsedMs: performance.now() - started };
}
