import OpenAI from 'openai';
import { env } from '../config/env.js';
import { HttpError } from '../middleware/errorHandler.js';

/**
 * Multi-provider AI layer.
 *
 * All supported providers expose an OpenAI-compatible Chat Completions API, so
 * we use the official `openai` SDK with a per-provider `baseURL`. Credentials
 * are supplied by the client (from Settings) on each request and used only in
 * memory — they are never persisted or logged. A server-side OPENAI_API_KEY may
 * act as a fallback default.
 */

export type AiProvider = 'openai' | 'claude' | 'gemini' | 'deepseek';

export interface AiCredentials {
  provider?: AiProvider;
  apiKey?: string;
  model?: string;
}

interface ProviderConfig {
  label: string;
  baseURL?: string;
  defaultModel: string;
  /** Provider supports `response_format: { type: 'json_object' }`. */
  jsonMode: boolean;
  /** Provider supports `stream_options: { include_usage: true }`. */
  usageOption: boolean;
}

export const PROVIDERS: Record<AiProvider, ProviderConfig> = {
  openai: {
    label: 'OpenAI',
    baseURL: undefined,
    defaultModel: env.openaiModel,
    jsonMode: true,
    usageOption: true,
  },
  deepseek: {
    label: 'DeepSeek',
    baseURL: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    jsonMode: true,
    usageOption: true,
  },
  gemini: {
    label: 'Google Gemini',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    defaultModel: 'gemini-2.0-flash',
    jsonMode: false,
    usageOption: false,
  },
  claude: {
    label: 'Anthropic Claude',
    baseURL: 'https://api.anthropic.com/v1/',
    defaultModel: 'claude-3-5-sonnet-latest',
    jsonMode: false,
    usageOption: false,
  },
};

export interface ResolvedAi {
  client: OpenAI;
  model: string;
  provider: AiProvider;
  config: ProviderConfig;
}

const isProvider = (value: unknown): value is AiProvider =>
  typeof value === 'string' && value in PROVIDERS;

/** Whether a usable credential exists (client-supplied or server fallback). */
export const aiAvailable = (creds?: AiCredentials): boolean =>
  Boolean(creds?.apiKey?.trim() || env.openaiApiKey);

// Cache clients by provider+key+baseURL to avoid rebuilding on every request.
const clientCache = new Map<string, OpenAI>();

/**
 * Resolve the AI client + model for a request.
 * @throws HttpError(503) when no credential is available.
 */
export function resolveAi(creds?: AiCredentials): ResolvedAi {
  const clientKey = creds?.apiKey?.trim();

  const provider: AiProvider = clientKey
    ? isProvider(creds?.provider)
      ? (creds!.provider as AiProvider)
      : 'openai'
    : 'openai';

  const apiKey = clientKey || env.openaiApiKey;
  if (!apiKey) {
    throw new HttpError(
      503,
      'No AI API key configured. Add a provider key in Settings to enable AI features.',
    );
  }

  const config = PROVIDERS[provider];
  const model = creds?.model?.trim() || config.defaultModel;

  const cacheKey = `${provider}:${config.baseURL ?? 'default'}:${apiKey}`;
  let client = clientCache.get(cacheKey);
  if (!client) {
    client = new OpenAI({ apiKey, baseURL: config.baseURL });
    clientCache.set(cacheKey, client);
  }

  return { client, model, provider, config };
}

/**
 * Robustly extract a JSON object from a model response that may wrap it in
 * Markdown fences or prose (needed for providers without strict JSON mode).
 */
export function extractJson(raw: string): Record<string, unknown> {
  const cleaned = raw.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
  // Prefer a direct parse; otherwise slice the outermost braces.
  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1)) as Record<
          string,
          unknown
        >;
      } catch {
        /* fall through */
      }
    }
    throw new HttpError(502, 'AI returned malformed JSON.');
  }
}
