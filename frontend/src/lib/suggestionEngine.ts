import { config } from '@/config/env';
import { storage } from '@/lib/storage';
import { aiCredsFromSettings } from '@/lib/aiProviders';
import type {
  Meeting,
  MeetingBrief,
  RetrievedChunk,
  Suggestions,
  TranscriptEntry,
} from '@/types';

/**
 * AI Suggestion Engine (client).
 *
 * Builds the suggestion context from the live meeting, streams suggestions
 * from the backend via Server-Sent Events, parses the streaming text into the
 * four output categories, and provides a local fallback when AI is disabled.
 */

const RECENT_ENTRIES = 12;

export interface SuggestionContextPayload {
  title?: string;
  currentTranscript: string;
  previousTranscript?: string;
  brief?: string;
  documents: { name: string; text: string }[];
  userContext: string[];
  retrievedContext?: { source: string; text: string }[];
}

const formatEntry = (e: TranscriptEntry): string => `${e.speaker}: ${e.text}`;

const condenseBrief = (brief: MeetingBrief): string =>
  [
    brief.summary,
    brief.keyTopics.length ? `Key topics: ${brief.keyTopics.join(', ')}` : '',
    brief.actionItems.length
      ? `Action items: ${brief.actionItems.join('; ')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');

export function buildSuggestionContext(
  meeting: Meeting,
  transcript: TranscriptEntry[],
  retrieved?: RetrievedChunk[],
): SuggestionContextPayload {
  const recent = transcript.slice(-RECENT_ENTRIES);
  const earlier = transcript.slice(0, Math.max(0, transcript.length - RECENT_ENTRIES));
  const hasRetrieval = Boolean(retrieved && retrieved.length > 0);

  return {
    title: meeting.title,
    currentTranscript: recent.map(formatEntry).join('\n'),
    previousTranscript: earlier.map(formatEntry).join('\n'),
    brief: meeting.brief ? condenseBrief(meeting.brief) : undefined,
    // When similarity search returned excerpts, send those instead of whole
    // documents so the prompt stays focused and token-efficient.
    documents: hasRetrieval
      ? []
      : (meeting.attachments ?? [])
          .filter((a) => a.extractedText?.trim())
          .map((a) => ({ name: a.name, text: a.extractedText ?? '' })),
    retrievedContext: hasRetrieval
      ? retrieved!.map((r) => ({ source: r.source, text: r.text }))
      : undefined,
    userContext: (meeting.context ?? [])
      .filter((c) => c.type !== 'link')
      .map((c) => `${c.type}: ${c.content}`),
  };
}

/* ---- Streaming parser ---- */

const SECTIONS: { key: keyof Suggestions; marker: string }[] = [
  { key: 'responses', marker: '[RESPONSES]' },
  { key: 'talkingPoints', marker: '[TALKING_POINTS]' },
  { key: 'questions', marker: '[QUESTIONS]' },
  { key: 'followups', marker: '[FOLLOWUPS]' },
];

const extractBullets = (body: string): string[] =>
  body
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) =>
      line
        .replace(/^[-*•]\s?/, '')
        .replace(/^\d+[.)]\s?/, '')
        .trim(),
    )
    .filter((line) => line && !line.startsWith('['));

/** Parse the (possibly partial) streamed text into the four categories. */
export function parseSuggestions(text: string): Suggestions {
  const result: Suggestions = {
    responses: [],
    talkingPoints: [],
    questions: [],
    followups: [],
  };

  SECTIONS.forEach((section, i) => {
    const start = text.indexOf(section.marker);
    if (start < 0) return;
    const from = start + section.marker.length;
    let to = text.length;
    SECTIONS.forEach((other, j) => {
      if (j === i) return;
      const idx = text.indexOf(other.marker, from);
      if (idx >= 0 && idx < to) to = idx;
    });
    result[section.key] = extractBullets(text.slice(from, to));
  });

  return result;
}

export const isEmptySuggestions = (s: Suggestions): boolean =>
  s.responses.length === 0 &&
  s.talkingPoints.length === 0 &&
  s.questions.length === 0 &&
  s.followups.length === 0;

/* ---- SSE streaming client ---- */

export interface TokenUsage {
  prompt: number;
  completion: number;
  total: number;
}

export interface StreamHandlers {
  onUpdate: (text: string) => void;
  onDone: (text: string) => void;
  onUsage?: (usage: TokenUsage) => void;
}

export class SuggestionStreamError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'SuggestionStreamError';
  }
}

/**
 * Stream suggestions from the backend. Calls `onUpdate` with the full
 * accumulated text on each delta and `onDone` when finished. Throws
 * SuggestionStreamError on setup or mid-stream failure so callers can fall
 * back to local suggestions.
 */
export async function streamSuggestions(
  payload: SuggestionContextPayload,
  handlers: StreamHandlers,
  signal: AbortSignal,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${config.apiUrl}/api/suggestions/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...payload,
        ai: aiCredsFromSettings(storage.getSettings()),
      }),
      signal,
    });
  } catch {
    throw new SuggestionStreamError(0, 'Cannot reach the suggestion service.');
  }

  if (!res.ok || !res.body) {
    let message = `Suggestion request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* ignore */
    }
    throw new SuggestionStreamError(res.status, message);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const events = buffer.split('\n\n');
    buffer = events.pop() ?? '';

    for (const raw of events) {
      let eventType = 'message';
      let data = '';
      for (const line of raw.split('\n')) {
        if (line.startsWith('event:')) eventType = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (!data) continue;

      if (eventType === 'error') {
        let message = 'Suggestion stream error.';
        try {
          message = JSON.parse(data).message ?? message;
        } catch {
          /* ignore */
        }
        throw new SuggestionStreamError(502, message);
      }
      if (eventType === 'usage') {
        try {
          handlers.onUsage?.(JSON.parse(data) as TokenUsage);
        } catch {
          /* ignore malformed usage */
        }
        continue;
      }
      if (eventType === 'done') {
        handlers.onDone(full);
        return;
      }
      try {
        const { delta } = JSON.parse(data) as { delta?: string };
        if (delta) {
          full += delta;
          handlers.onUpdate(full);
        }
      } catch {
        /* skip malformed event */
      }
    }
  }
  handlers.onDone(full);
}

/* ---- Local fallback (no AI) ---- */

const lastSpeaker = (transcript: TranscriptEntry[]): string | undefined =>
  transcript[transcript.length - 1]?.speaker;

/**
 * Heuristic suggestions assembled from the meeting's structured data. Used
 * when the OpenAI key is not configured or the service is unreachable.
 */
export function localSuggestions(
  meeting: Meeting,
  transcript: TranscriptEntry[],
): Suggestions {
  const brief = meeting.brief;
  const kb = meeting.knowledgeBase;
  const goals = (meeting.context ?? [])
    .filter((c) => c.type === 'goal')
    .map((c) => c.content);
  const speaker = lastSpeaker(transcript);

  const responses = [
    speaker ? `Acknowledge ${speaker}'s point and add your perspective.` : 'Open with the meeting objective.',
    'Summarize what has been agreed so far to keep alignment.',
    ...(brief?.questions ?? []).slice(0, 1).map((q) => q.response),
  ].filter(Boolean);

  const talkingPoints = (
    kb?.talkingPoints ??
    brief?.keyTopics ??
    meeting.agenda ??
    []
  ).slice(0, 4);

  const questions = (
    brief?.questions?.map((q) => q.question) ??
    []
  ).slice(0, 4);
  if (questions.length === 0) {
    questions.push('What does success look like for this discussion?');
    if (goals[0]) questions.push(`How are we tracking against "${goals[0]}"?`);
  }

  const followups = (
    brief?.actionItems ??
    kb?.risks?.map((r) => `Mitigate: ${r}`) ??
    goals.map((g) => `Plan next step for: ${g}`)
  ).slice(0, 4);

  return { responses, talkingPoints, questions, followups };
}
