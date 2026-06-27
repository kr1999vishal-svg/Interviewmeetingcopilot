import { createId } from '../utils/id.js';
import { HttpError } from '../middleware/errorHandler.js';
import type {
  CreateMeetingInput,
  Meeting,
  MeetingSummary,
  TranscriptEntry,
} from '../types/index.js';

/**
 * In-memory meeting store. The frontend treats localStorage as the source of
 * truth; this server keeps a transient copy to coordinate live sessions and
 * generate summaries. No database is used.
 */
class MeetingService {
  private meetings = new Map<string, Meeting>();

  list(): Meeting[] {
    return Array.from(this.meetings.values()).sort(
      (a, b) => b.updatedAt - a.updatedAt,
    );
  }

  get(id: string): Meeting {
    const meeting = this.meetings.get(id);
    if (!meeting) {
      throw new HttpError(404, `Meeting "${id}" not found`);
    }
    return meeting;
  }

  create(input: CreateMeetingInput): Meeting {
    if (!input.title?.trim()) {
      throw new HttpError(400, 'Meeting title is required');
    }
    const now = Date.now();
    const meeting: Meeting = {
      id: createId(),
      title: input.title.trim(),
      description: input.description?.trim() ?? '',
      scheduledAt: input.scheduledAt,
      durationMinutes: input.durationMinutes ?? 30,
      status: 'scheduled',
      participants: input.participants ?? [],
      agenda: input.agenda ?? [],
      context: [],
      transcript: [],
      notes: '',
      createdAt: now,
      updatedAt: now,
    };
    this.meetings.set(meeting.id, meeting);
    return meeting;
  }

  update(id: string, patch: Partial<Meeting>): Meeting {
    const meeting = this.get(id);
    const updated: Meeting = {
      ...meeting,
      ...patch,
      id: meeting.id,
      createdAt: meeting.createdAt,
      updatedAt: Date.now(),
    };
    this.meetings.set(id, updated);
    return updated;
  }

  remove(id: string): void {
    if (!this.meetings.delete(id)) {
      throw new HttpError(404, `Meeting "${id}" not found`);
    }
  }

  /** Upsert a meeting coming from the client (localStorage sync). */
  sync(meeting: Meeting): Meeting {
    this.meetings.set(meeting.id, { ...meeting, updatedAt: Date.now() });
    return this.meetings.get(meeting.id)!;
  }

  /**
   * Return the meeting, creating a minimal placeholder if it is unknown. The
   * backend store is transient (no DB) and can be empty after a restart while a
   * live session is still running; live transcript/note relays must not fail.
   * The client later upserts the full record via {@link sync}.
   */
  private ensure(id: string): Meeting {
    const existing = this.meetings.get(id);
    if (existing) return existing;
    const now = Date.now();
    const placeholder: Meeting = {
      id,
      title: 'Live Meeting',
      description: '',
      scheduledAt: new Date(now).toISOString(),
      durationMinutes: 30,
      status: 'live',
      participants: [],
      agenda: [],
      context: [],
      transcript: [],
      notes: '',
      createdAt: now,
      updatedAt: now,
    };
    this.meetings.set(id, placeholder);
    return placeholder;
  }

  appendTranscript(id: string, entry: TranscriptEntry): Meeting {
    const meeting = this.ensure(id);
    meeting.transcript.push(entry);
    meeting.updatedAt = Date.now();
    return meeting;
  }

  setNotes(id: string, notes: string): Meeting {
    const meeting = this.ensure(id);
    meeting.notes = notes;
    meeting.updatedAt = Date.now();
    return meeting;
  }

  /**
   * Produce a deterministic summary from transcript + notes. This is a simple
   * heuristic stand-in for an LLM so the app works fully offline.
   */
  generateSummary(id: string): Meeting {
    const meeting = this.get(id);
    const lines = meeting.transcript.map((t) => t.text).filter(Boolean);
    const noteLines = meeting.notes
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    const decisions = [...lines, ...noteLines].filter((l) =>
      /\b(decide|decided|agree|agreed|conclusion|will)\b/i.test(l),
    );

    const actionItems = [...lines, ...noteLines]
      .filter((l) => /\b(todo|action|follow up|assign|owner|next step)\b/i.test(l))
      .map((text) => ({ id: createId(), text, done: false }));

    const risks = [...lines, ...noteLines].filter((l) =>
      /\b(risk|concern|blocker|issue|problem|challenge|delay|depend)\b/i.test(l),
    );

    const followUps = [...lines, ...noteLines].filter((l) =>
      /\b(follow up|follow-up|circle back|revisit|next meeting|later|schedule)\b/i.test(l),
    );

    const overview =
      lines.length > 0
        ? `Discussed ${meeting.title} with ${meeting.participants.length} participant(s). ${lines.length} transcript entries captured.`
        : `No live transcript was recorded for ${meeting.title}.`;

    const summary: MeetingSummary = {
      overview,
      decisions: decisions.slice(0, 10),
      actionItems: actionItems.slice(0, 20),
      risks: risks.slice(0, 10),
      followUps: followUps.slice(0, 10),
      generatedAt: Date.now(),
      source: 'local',
    };

    return this.update(id, { summary, status: 'completed' });
  }
}

export const meetingService = new MeetingService();
