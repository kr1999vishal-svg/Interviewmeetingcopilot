import { config } from '@/config/env';
import { storage } from '@/lib/storage';
import { aiCredsFromSettings, type AiCredentials } from '@/lib/aiProviders';
import type { Meeting, MeetingBrief } from '@/types';

/** Current AI credentials from settings, or undefined when none are set. */
const currentAiCreds = (): AiCredentials | undefined =>
  aiCredsFromSettings(storage.getSettings());

export interface AiKeyTestResult {
  ok: boolean;
  message: string;
  model?: string;
}

export interface BriefContextPayload {
  title: string;
  type?: string;
  description?: string;
  durationMinutes?: number;
  scheduledAt?: string;
  participants: { name: string; role?: string }[];
  agenda: string[];
  notes: string[];
  goals: string[];
  documents: { name: string; text: string }[];
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${config.apiUrl}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...init,
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Is the backend running?');
  }

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* ignore parse errors */
    }
    throw new ApiError(res.status, message);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  health: () => request<{ status: string }>('/health'),
  listMeetings: () => request<Meeting[]>('/api/meetings'),
  syncMeeting: (meeting: Meeting) =>
    request<Meeting>('/api/meetings/sync', {
      method: 'POST',
      body: JSON.stringify(meeting),
    }),
  summarize: (id: string) =>
    request<Meeting>(`/api/meetings/${id}/summary`, {
      method: 'POST',
      body: JSON.stringify({ ai: currentAiCreds() }),
    }),
  briefStatus: () => request<{ enabled: boolean }>('/api/brief/status'),
  generateBrief: (payload: BriefContextPayload) =>
    request<MeetingBrief>('/api/brief', {
      method: 'POST',
      body: JSON.stringify({ ...payload, ai: currentAiCreds() }),
    }),
  testAiKey: (creds: AiCredentials) =>
    request<AiKeyTestResult>('/api/ai/test', {
      method: 'POST',
      body: JSON.stringify(creds),
    }),
};
