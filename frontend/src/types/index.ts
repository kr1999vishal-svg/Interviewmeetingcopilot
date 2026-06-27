export type MeetingStatus = 'scheduled' | 'live' | 'completed';

export type MeetingType =
  | 'standup'
  | 'one-on-one'
  | 'planning'
  | 'retrospective'
  | 'brainstorm'
  | 'interview'
  | 'client'
  | 'other';

export const MEETING_TYPES: { value: MeetingType; label: string }[] = [
  { value: 'standup', label: 'Standup' },
  { value: 'one-on-one', label: '1:1' },
  { value: 'planning', label: 'Planning' },
  { value: 'retrospective', label: 'Retrospective' },
  { value: 'brainstorm', label: 'Brainstorm' },
  { value: 'interview', label: 'Interview' },
  { value: 'client', label: 'Client' },
  { value: 'other', label: 'Other' },
];

export const meetingTypeLabel = (type: MeetingType): string =>
  MEETING_TYPES.find((t) => t.value === type)?.label ?? 'Other';

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

export type ExtractionStatus = 'pending' | 'done' | 'error' | 'empty';

export interface Attachment {
  id: string;
  name: string;
  size: number;
  extension: string;
  mimeType: string;
  /** base64 data URL of the file contents, stored in localStorage. */
  dataUrl: string;
  uploadedAt: number;
  /** Plain text extracted from the document (may be truncated). */
  extractedText?: string;
  extractionStatus?: ExtractionStatus;
  extractionError?: string;
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

export interface SupportingDocument {
  id: string;
  name: string;
  type: string;
  excerpt: string;
  wordCount: number;
}

export interface KnowledgeBaseParticipant {
  name: string;
  role?: string;
}

/** Structured pre-meeting context derived from chat, files, and metadata. */
export interface KnowledgeBase {
  meetingSummary: string;
  participants: KnowledgeBaseParticipant[];
  goals: string[];
  risks: string[];
  talkingPoints: string[];
  keyTopics: string[];
  supportingDocuments: SupportingDocument[];
  generatedAt: number;
}

export interface BriefQA {
  question: string;
  response: string;
}

/** AI-generated, user-editable meeting brief. */
export interface MeetingBrief {
  summary: string;
  keyTopics: string[];
  questions: BriefQA[];
  importantFacts: string[];
  actionItems: string[];
  generatedAt: number;
  source: 'openai' | 'local';
  model?: string;
  edited?: boolean;
}

export interface Suggestions {
  responses: string[];
  talkingPoints: string[];
  questions: string[];
  followups: string[];
}

/* ---- Document retrieval (RAG) ---- */

export interface DocumentChunk {
  id: string;
  attachmentId: string;
  attachmentName: string;
  index: number;
  text: string;
}

export interface EmbeddedChunk extends DocumentChunk {
  embedding: number[];
}

export interface RetrievedChunk {
  source: string;
  text: string;
  score: number;
}

export interface Meeting {
  id: string;
  title: string;
  type: MeetingType;
  description?: string;
  /** Google Meet / Microsoft Teams link used by the browser-extension overlay. */
  meetingUrl?: string;
  scheduledAt: string;
  durationMinutes: number;
  status: MeetingStatus;
  participants: Participant[];
  agenda: string[];
  context: ContextItem[];
  attachments: Attachment[];
  transcript: TranscriptEntry[];
  notes: string;
  summary?: MeetingSummary;
  knowledgeBase?: KnowledgeBase;
  brief?: MeetingBrief;
  createdAt: number;
  updatedAt: number;
}

export interface CreateMeetingInput {
  title: string;
  type: MeetingType;
  description?: string;
  scheduledAt: string;
  durationMinutes: number;
  participants: Participant[];
  agenda: string[];
}

export type AiProvider = 'openai' | 'claude' | 'gemini' | 'deepseek';

export interface UserSettings {
  displayName: string;
  defaultDuration: number;
  syncToServer: boolean;
  /** Which AI provider to use for briefs, summaries, and live suggestions. */
  aiProvider: AiProvider;
  /**
   * Stored in the browser's localStorage and sent to our backend at request
   * time (used in-memory only) so it can call the chosen provider.
   */
  aiApiKey: string;
  /** Optional model override; falls back to the provider's default. */
  aiModel?: string;
  /** @deprecated Retained for backward compatibility/migration. */
  openaiApiKey?: string;
}

export type ServerMessage =
  | { type: 'joined'; meetingId: string; clients: number }
  | { type: 'transcript'; entry: TranscriptEntry }
  | { type: 'note'; notes: string }
  | { type: 'presence'; clients: number }
  | { type: 'error'; message: string };

export type ClientMessage =
  | { type: 'join'; meetingId: string }
  | { type: 'transcript'; meetingId: string; speaker: string; text: string }
  | { type: 'note'; meetingId: string; notes: string }
  | { type: 'leave'; meetingId: string };
