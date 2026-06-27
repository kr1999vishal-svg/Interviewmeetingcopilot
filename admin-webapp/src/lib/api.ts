const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000';

export interface BackendConfig {
  backendUrl: string;
  aiProvider: 'openai' | 'anthropic' | 'google';
  apiKey: string;
  model?: string;
  sttProvider: 'openai' | 'anthropic' | 'google';
  sttApiKey: string;
  sttModel: string;
}

export async function saveBackendConfig(config: BackendConfig): Promise<void> {
  const response = await fetch(`${BACKEND_URL}/api/admin/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!response.ok) throw new Error('Failed to save backend config');
}

export async function getBackendConfig(): Promise<BackendConfig> {
  const response = await fetch(`${BACKEND_URL}/api/admin/config`);
  if (!response.ok) throw new Error('Failed to get backend config');
  return response.json();
}

export async function getUsers(): Promise<any[]> {
  const response = await fetch(`${BACKEND_URL}/api/admin/users`);
  if (!response.ok) throw new Error('Failed to get users');
  return response.json();
}

export async function getUsageStats(): Promise<any> {
  const response = await fetch(`${BACKEND_URL}/api/admin/stats`);
  if (!response.ok) throw new Error('Failed to get usage stats');
  return response.json();
}
