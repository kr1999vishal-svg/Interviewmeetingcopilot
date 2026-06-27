import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, X, ArrowRight } from 'lucide-react';
import { storage } from '@/lib/storage';
import { createId } from '@/lib/format';
import { ErrorBanner, PageHeader } from '@/components/ui';
import type { Meeting, MeetingType, Participant } from '@/types';
import { MEETING_TYPES } from '@/types';

export default function CreateMeeting() {
  const navigate = useNavigate();
  const settings = storage.getSettings();

  const [title, setTitle] = useState('');
  const [type, setType] = useState<MeetingType>('standup');
  const [description, setDescription] = useState('');
  const [meetingUrl, setMeetingUrl] = useState('');
  const [scheduledAt, setScheduledAt] = useState(
    new Date(Date.now() + 3600_000).toISOString().slice(0, 16),
  );
  const [duration, setDuration] = useState(settings.defaultDuration);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [participantName, setParticipantName] = useState('');
  const [agenda, setAgenda] = useState<string[]>([]);
  const [agendaItem, setAgendaItem] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const addParticipant = () => {
    const name = participantName.trim();
    if (!name) return;
    setParticipants((p) => [...p, { id: createId(), name }]);
    setParticipantName('');
  };

  const addAgenda = () => {
    const item = agendaItem.trim();
    if (!item) return;
    setAgenda((a) => [...a, item]);
    setAgendaItem('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError('Please enter a meeting title.');
      return;
    }

    setSaving(true);
    try {
      const now = Date.now();
      const meeting: Meeting = {
        id: createId(),
        title: title.trim(),
        type,
        description: description.trim(),
        meetingUrl: meetingUrl.trim() || undefined,
        scheduledAt: new Date(scheduledAt).toISOString(),
        durationMinutes: Number(duration) || 30,
        status: 'scheduled',
        participants,
        agenda,
        context: [],
        attachments: [],
        transcript: [],
        notes: '',
        createdAt: now,
        updatedAt: now,
      };
      storage.saveMeeting(meeting);
      navigate(`/meetings/${meeting.id}/context`);
    } catch {
      setError('Could not save the meeting. Please try again.');
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Create Meeting"
        subtitle="Set up a new meeting and add participants & agenda."
      />

      <form onSubmit={handleSubmit} className="card space-y-5 p-6">
        {error && <ErrorBanner message={error} />}

        <div>
          <label className="label">Title</label>
          <input
            className="input"
            placeholder="Weekly product sync"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />
        </div>

        <div>
          <label className="label">Meeting Type</label>
          <select
            className="input"
            value={type}
            onChange={(e) => setType(e.target.value as MeetingType)}
          >
            {MEETING_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label">Description</label>
          <textarea
            className="input min-h-[80px] resize-y"
            placeholder="What is this meeting about?"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div>
          <label className="label">Meeting Link</label>
          <input
            className="input"
            type="url"
            placeholder="https://meet.google.com/abc-defg-hij or Teams link"
            value={meetingUrl}
            onChange={(e) => setMeetingUrl(e.target.value)}
          />
          <p className="mt-1 text-xs text-slate-500">
            Google Meet or Microsoft Teams link. The Copilot browser extension
            will only assist this meeting.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Date & Time</label>
            <input
              type="datetime-local"
              className="input"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Duration (minutes)</label>
            <input
              type="number"
              min={5}
              step={5}
              className="input"
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
            />
          </div>
        </div>

        <div>
          <label className="label">Participants</label>
          <div className="flex gap-2">
            <input
              className="input"
              placeholder="Add participant name"
              value={participantName}
              onChange={(e) => setParticipantName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addParticipant();
                }
              }}
            />
            <button type="button" className="btn-secondary" onClick={addParticipant}>
              <Plus className="h-4 w-4" />
            </button>
          </div>
          {participants.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {participants.map((p) => (
                <span key={p.id} className="badge bg-surface-muted text-slate-200">
                  {p.name}
                  <button
                    type="button"
                    onClick={() =>
                      setParticipants((list) => list.filter((x) => x.id !== p.id))
                    }
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        <div>
          <label className="label">Agenda</label>
          <div className="flex gap-2">
            <input
              className="input"
              placeholder="Add agenda item"
              value={agendaItem}
              onChange={(e) => setAgendaItem(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addAgenda();
                }
              }}
            />
            <button type="button" className="btn-secondary" onClick={addAgenda}>
              <Plus className="h-4 w-4" />
            </button>
          </div>
          {agenda.length > 0 && (
            <ol className="mt-3 space-y-2">
              {agenda.map((item, index) => (
                <li
                  key={`${item}-${index}`}
                  className="flex items-center justify-between rounded-lg bg-surface-muted px-3 py-2 text-sm"
                >
                  <span>
                    <span className="mr-2 text-slate-500">{index + 1}.</span>
                    {item}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setAgenda((list) => list.filter((_, i) => i !== index))
                    }
                  >
                    <X className="h-3.5 w-3.5 text-slate-400" />
                  </button>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="flex justify-end gap-3 border-t border-surface-border pt-5">
          <button
            type="button"
            className="btn-ghost"
            onClick={() => navigate('/')}
          >
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Saving...' : 'Continue'}
            {!saving && <ArrowRight className="h-4 w-4" />}
          </button>
        </div>
      </form>
    </div>
  );
}
