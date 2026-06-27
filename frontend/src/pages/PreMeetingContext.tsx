import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import {
  FileText,
  Link2,
  Target,
  Plus,
  X,
  Play,
  ArrowLeft,
  Sparkles,
} from 'lucide-react';
import { storage } from '@/lib/storage';
import { createId } from '@/lib/format';
import { ErrorBanner, PageHeader, Spinner } from '@/components/ui';
import FileUpload from '@/components/FileUpload';
import KnowledgeBasePanel from '@/components/KnowledgeBasePanel';
import { generateKnowledgeBase } from '@/lib/knowledgeBase';
import type { Attachment, ContextItem, Meeting } from '@/types';

const typeMeta = {
  note: { label: 'Note', icon: FileText, color: 'text-brand-300' },
  link: { label: 'Link', icon: Link2, color: 'text-sky-300' },
  goal: { label: 'Goal', icon: Target, color: 'text-emerald-300' },
} as const;

export default function PreMeetingContext() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [type, setType] = useState<ContextItem['type']>('note');
  const [content, setContent] = useState('');
  const [generatingKB, setGeneratingKB] = useState(false);

  useEffect(() => {
    const found = id ? storage.getMeeting(id) : undefined;
    if (!found) {
      setError('Meeting not found.');
    } else {
      setMeeting(found);
    }
    setLoading(false);
  }, [id]);

  const persist = (next: Meeting) => {
    next.updatedAt = Date.now();
    storage.saveMeeting(next);
    setMeeting({ ...next });
  };

  const addItem = () => {
    if (!meeting || !content.trim()) return;
    const item: ContextItem = { id: createId(), type, content: content.trim() };
    persist({ ...meeting, context: [...meeting.context, item] });
    setContent('');
  };

  const removeItem = (itemId: string) => {
    if (!meeting) return;
    persist({
      ...meeting,
      context: meeting.context.filter((c) => c.id !== itemId),
    });
  };

  // May throw if localStorage is full; FileUpload surfaces the error to the user.
  const addAttachment = (attachment: Attachment) => {
    if (!meeting) return;
    persist({
      ...meeting,
      attachments: [...(meeting.attachments ?? []), attachment],
    });
  };

  const removeAttachment = (attachmentId: string) => {
    if (!meeting) return;
    persist({
      ...meeting,
      attachments: (meeting.attachments ?? []).filter(
        (a) => a.id !== attachmentId,
      ),
    });
  };

  const generateKB = () => {
    if (!meeting) return;
    setGeneratingKB(true);
    setError(null);
    // Let the UI paint the loading state before the synchronous build.
    setTimeout(() => {
      try {
        const knowledgeBase = generateKnowledgeBase(meeting);
        persist({ ...meeting, knowledgeBase });
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : 'Could not generate the knowledge base.',
        );
      } finally {
        setGeneratingKB(false);
      }
    }, 50);
  };

  const startMeeting = () => {
    if (!meeting) return;
    persist({ ...meeting, status: 'live' });
    navigate(`/meetings/${meeting.id}/live`);
  };

  if (loading) return <Spinner label="Loading context..." />;
  if (error || !meeting)
    return (
      <div className="space-y-4">
        <ErrorBanner message={error ?? 'Meeting not found.'} />
        <Link to="/" className="btn-secondary">
          <ArrowLeft className="h-4 w-4" /> Back to dashboard
        </Link>
      </div>
    );

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Pre-Meeting Context"
        subtitle={meeting.title}
        actions={
          <div className="flex items-center gap-2">
            <Link to={`/meetings/${meeting.id}/brief`} className="btn-secondary">
              <Sparkles className="h-4 w-4" /> AI Brief
            </Link>
            <button className="btn-primary" onClick={startMeeting}>
              <Play className="h-4 w-4" /> Start Meeting
            </button>
          </div>
        }
      />

      {meeting.agenda.length > 0 && (
        <div className="card mb-6 p-5">
          <h3 className="mb-3 text-sm font-semibold text-slate-300">Agenda</h3>
          <ol className="space-y-1.5 text-sm text-slate-300">
            {meeting.agenda.map((item, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-slate-500">{i + 1}.</span>
                {item}
              </li>
            ))}
          </ol>
        </div>
      )}

      <FileUpload
        attachments={meeting.attachments ?? []}
        onAdd={addAttachment}
        onRemove={removeAttachment}
      />

      <KnowledgeBasePanel
        knowledgeBase={meeting.knowledgeBase}
        generating={generatingKB}
        onGenerate={generateKB}
      />

      <div className="card mb-6 p-5">
        <h3 className="mb-3 text-sm font-semibold text-slate-300">
          Add context
        </h3>
        <div className="mb-3 flex gap-2">
          {(Object.keys(typeMeta) as ContextItem['type'][]).map((key) => {
            const meta = typeMeta[key];
            const active = type === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setType(key)}
                className={`btn px-3 py-1.5 text-xs ${
                  active
                    ? 'bg-brand-600 text-white'
                    : 'bg-surface-muted text-slate-300'
                }`}
              >
                <meta.icon className="h-3.5 w-3.5" /> {meta.label}
              </button>
            );
          })}
        </div>
        <div className="flex gap-2">
          <input
            className="input"
            placeholder={
              type === 'link' ? 'https://...' : `Add a ${typeMeta[type].label.toLowerCase()}`
            }
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addItem();
              }
            }}
          />
          <button type="button" className="btn-secondary" onClick={addItem}>
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="space-y-2">
        {meeting.context.length === 0 ? (
          <p className="rounded-lg border border-dashed border-surface-border py-8 text-center text-sm text-slate-500">
            No context added yet. Notes, links, and goals will appear here.
          </p>
        ) : (
          meeting.context.map((item) => {
            const meta = typeMeta[item.type];
            return (
              <div
                key={item.id}
                className="card flex items-start justify-between gap-3 p-4"
              >
                <div className="flex items-start gap-3">
                  <meta.icon className={`mt-0.5 h-4 w-4 ${meta.color}`} />
                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate-500">
                      {meta.label}
                    </p>
                    {item.type === 'link' ? (
                      <a
                        href={item.content}
                        target="_blank"
                        rel="noreferrer"
                        className="break-all text-sm text-brand-300 hover:underline"
                      >
                        {item.content}
                      </a>
                    ) : (
                      <p className="text-sm text-slate-200">{item.content}</p>
                    )}
                  </div>
                </div>
                <button onClick={() => removeItem(item.id)}>
                  <X className="h-4 w-4 text-slate-400 hover:text-red-300" />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
