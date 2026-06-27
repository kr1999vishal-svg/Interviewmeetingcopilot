import type { AiProvider, UserSettings } from '@/types';

/**
 * Client-side metadata for the supported AI providers. Keys are stored in the
 * browser and sent to our backend per request, which calls the provider via an
 * OpenAI-compatible endpoint.
 */

export interface ProviderMeta {
  id: AiProvider;
  label: string;
  defaultModel: string;
  keyPlaceholder: string;
  keyHint: string;
  consoleUrl: string;
}

export const AI_PROVIDERS: ProviderMeta[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    defaultModel: 'gpt-4o-mini',
    keyPlaceholder: 'sk-...',
    keyHint: 'Keys start with "sk-".',
    consoleUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'claude',
    label: 'Anthropic Claude',
    defaultModel: 'claude-3-5-sonnet-latest',
    keyPlaceholder: 'sk-ant-...',
    keyHint: 'Keys start with "sk-ant-".',
    consoleUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    defaultModel: 'gemini-2.0-flash',
    keyPlaceholder: 'AIza... or API key',
    keyHint: 'Create a key in Google AI Studio.',
    consoleUrl: 'https://aistudio.google.com/app/apikey',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    defaultModel: 'deepseek-chat',
    keyPlaceholder: 'sk-...',
    keyHint: 'Keys start with "sk-".',
    consoleUrl: 'https://platform.deepseek.com/api_keys',
  },
];

export const getProviderMeta = (id: AiProvider): ProviderMeta =>
  AI_PROVIDERS.find((p) => p.id === id) ?? AI_PROVIDERS[0];

export interface AiCredentials {
  provider: AiProvider;
  apiKey: string;
  model?: string;
}

/**
 * Build the credential payload from settings, or `undefined` when no key is
 * configured (so callers can fall back to local/heuristic behavior).
 */
export function aiCredsFromSettings(
  settings: UserSettings,
): AiCredentials | undefined {
  const apiKey = (settings.aiApiKey || settings.openaiApiKey || '').trim();
  if (!apiKey) return undefined;
  return {
    provider: settings.aiProvider ?? 'openai',
    apiKey,
    model: settings.aiModel?.trim() || undefined,
  };
}
