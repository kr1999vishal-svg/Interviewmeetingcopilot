export type MeetingStatus = 'scheduled' | 'live' | 'completed';

export interface Participant {
  id: string;
  name: string;
  email?: string;
  role?: string;
}

export interface ContextItem {
  id: string;
  type: 'note' | 'link' | 'goal';
  content: string;
}

export interface TranscriptEntry {
  id: string;
  speaker: string;
  text: string;
  timestamp: number;
}

export interface ActionItem {
  id: string;
  text: string;
  owner?: string;
  done: boolean;
}

export interface MeetingSummary {
  overview: string;
  decisions: string[];
  actionItems: ActionItem[];
  risks: string[];
  followUps: string[];
  generatedAt: number;
  source?: 'openai' | 'local';
  model?: string;
}

export interface Meeting {
  id: string;
  title: string;
  description?: string;
  scheduledAt: string;
  durationMinutes: number;
  status: MeetingStatus;
  participants: Participant[];
  agenda: string[];
  context: ContextItem[];
  transcript: TranscriptEntry[];
  notes: string;
  summary?: MeetingSummary;
  createdAt: number;
  updatedAt: number;
}

export type CreateMeetingInput = Pick<
  Meeting,
  'title' | 'description' | 'scheduledAt' | 'durationMinutes' | 'participants' | 'agenda'
>;

/* ---- AI Meeting Brief ---- */

export interface BriefDocument {
  name: string;
  text: string;
}

export interface BriefContext {
  title: string;
  type?: string;
  description?: string;
  durationMinutes?: number;
  scheduledAt?: string;
  participants: { name: string; role?: string }[];
  agenda: string[];
  notes: string[];
  goals: string[];
  documents: BriefDocument[];
}

export interface BriefQA {
  question: string;
  response: string;
}

export interface MeetingBrief {
  summary: string;
  keyTopics: string[];
  questions: BriefQA[];
  importantFacts: string[];
  actionItems: string[];
  generatedAt: number;
  source: 'openai' | 'local';
  model?: string;
}

/* ---- AI Suggestion Engine ---- */

export interface SuggestionContext {
  title?: string;
  /** The most recent portion of the conversation. */
  currentTranscript: string;
  /** Earlier conversation for background context. */
  previousTranscript?: string;
  /** Condensed meeting brief, if one was generated. */
  brief?: string;
  documents: BriefDocument[];
  /** Notes, goals, and other user-provided context. */
  userContext: string[];
  /** Document excerpts retrieved by similarity search against the transcript. */
  retrievedContext?: RetrievedExcerpt[];
}

export interface RetrievedExcerpt {
  source: string;
  text: string;
}

/* ---- WebSocket message contracts ---- */

export type ClientMessage =
  | { type: 'join'; meetingId: string }
  | { type: 'transcript'; meetingId: string; speaker: string; text: string }
  | { type: 'note'; meetingId: string; notes: string }
  | { type: 'audio-start'; meetingId: string; mimeType?: string }
  | { type: 'audio-stop'; meetingId: string }
  | { type: 'leave'; meetingId: string };

export type ServerMessage =
  | { type: 'joined'; meetingId: string; clients: number }
  | { type: 'transcript'; entry: TranscriptEntry }
  | { type: 'note'; notes: string }
  | { type: 'presence'; clients: number }
  | { type: 'audio-status'; recording: boolean; mimeType?: string }
  | { type: 'audio-ack'; bytes: number }
  | { type: 'error'; message: string };
