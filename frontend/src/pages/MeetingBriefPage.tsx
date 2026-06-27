import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  Sparkles,
  FileText,
  Hash,
  HelpCircle,
  Lightbulb,
  ListChecks,
  Plus,
  X,
  Save,
  RefreshCw,
  ArrowLeft,
  CheckCircle2,
  Cpu,
} from 'lucide-react';
import { storage } from '@/lib/storage';
import { api, ApiError } from '@/lib/api';
import { buildBriefContext, localBrief } from '@/lib/brief';
import { ErrorBanner, PageHeader, Spinner } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import type { BriefQA, Meeting, MeetingBrief } from '@/types';

export default function MeetingBriefPage() {
  const { id } = useParams<{ id: string }>();
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [draft, setDraft] = useState<MeetingBrief | null>(null);
  const [dirty, setDirty] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    const found = id ? storage.getMeeting(id) : undefined;
    if (!found) {
      setLoadError('Meeting not found.');
    } else {
      setMeeting(found);
      setDraft(found.brief ?? null);
    }
    setLoading(false);
  }, [id]);

  const update = (patch: Partial<MeetingBrief>) => {
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev));
    setDirty(true);
  };

  const generate = async () => {
    if (!meeting) return;
    setGenerating(true);
    setNotice(null);
    try {
      const brief = await api.generateBrief(buildBriefContext(meeting));
      setDraft(brief);
      persist(meeting, brief);
    } catch (err) {
      // Graceful fallback to a local brief so the feature works without a key.
      const brief = localBrief(meeting);
      setDraft(brief);
      persist(meeting, brief);
      const reason =
        err instanceof ApiError && err.status === 503
          ? 'No OpenAI key configured on the server'
          : err instanceof ApiError && err.status === 0
            ? 'Backend unreachable'
            : err instanceof Error
              ? err.message
              : 'AI request failed';
      setNotice(`${reason} — generated a local brief instead.`);
    } finally {
      setGenerating(false);
    }
  };

  const persist = (target: Meeting, brief: MeetingBrief) => {
    try {
      const next: Meeting = { ...target, brief, updatedAt: Date.now() };
      storage.saveMeeting(next);
      setMeeting(next);
      setDirty(false);
      setSavedAt(Date.now());
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not save brief.');
    }
  };

  const save = () => {
    if (!meeting || !draft) return;
    persist(meeting, { ...draft, edited: true });
  };

  if (loading) return <Spinner label="Loading brief..." />;
  if (loadError || !meeting)
    return (
      <div className="space-y-4">
        <ErrorBanner message={loadError ?? 'Meeting not found.'} />
        <Link to="/" className="btn-secondary">
          <ArrowLeft className="h-4 w-4" /> Back to dashboard
        </Link>
      </div>
    );

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="AI Meeting Brief"
        subtitle={meeting.title}
        actions={
          <div className="flex items-center gap-2">
            <Link
              to={`/meetings/${meeting.id}/context`}
              className="btn-ghost"
            >
              <ArrowLeft className="h-4 w-4" /> Context
            </Link>
            <button
              className="btn-secondary"
              onClick={generate}
              disabled={generating}
            >
              <RefreshCw className={`h-4 w-4 ${generating ? 'animate-spin' : ''}`} />
              {draft ? 'Regenerate' : 'Generate'}
            </button>
            <button
              className="btn-primary"
              onClick={save}
              disabled={!draft || !dirty}
            >
              <Save className="h-4 w-4" /> Save
            </button>
          </div>
        }
      />

      {notice && (
        <div className="mb-4">
          <ErrorBanner message={notice} />
        </div>
      )}

      {!draft ? (
        generating ? (
          <Spinner label="Generating brief with AI..." />
        ) : (
          <div className="card flex flex-col items-center justify-center py-16 text-center">
            <Sparkles className="mb-4 h-10 w-10 text-brand-300" />
            <h3 className="text-lg font-semibold text-white">
              No brief generated yet
            </h3>
            <p className="mt-1 max-w-sm text-sm text-slate-400">
              Generate an AI meeting brief from your context, documents, and
              meeting details. You can edit everything afterward.
            </p>
            <button
              className="btn-primary mt-5"
              onClick={generate}
              disabled={generating}
            >
              <Sparkles className="h-4 w-4" /> Generate Brief
            </button>
          </div>
        )
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
            <span className="badge bg-surface-muted text-slate-300">
              {draft.source === 'openai' ? (
                <>
                  <Cpu className="h-3 w-3" /> AI · {draft.model ?? 'OpenAI'}
                </>
              ) : (
                <>
                  <Cpu className="h-3 w-3" /> Local generator
                </>
              )}
            </span>
            <span className="flex items-center gap-3">
              {dirty && <span className="text-amber-300">Unsaved changes</span>}
              {savedAt && !dirty && (
                <span className="flex items-center gap-1 text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Saved
                </span>
              )}
              <span>Generated {formatDateTime(draft.generatedAt)}</span>
            </span>
          </div>

          {/* 1. Meeting Summary */}
          <BriefCard icon={<FileText className="h-4 w-4 text-brand-300" />} title="Meeting Summary">
            <textarea
              className="input min-h-[100px] resize-y"
              value={draft.summary}
              onChange={(e) => update({ summary: e.target.value })}
              placeholder="Meeting summary..."
            />
          </BriefCard>

          {/* 2. Key Topics */}
          <BriefCard icon={<Hash className="h-4 w-4 text-violet-300" />} title="Key Topics">
            <StringListEditor
              items={draft.keyTopics}
              placeholder="Add a topic"
              onChange={(keyTopics) => update({ keyTopics })}
            />
          </BriefCard>

          {/* 3 & 4. Potential Questions + Suggested Responses */}
          <BriefCard
            icon={<HelpCircle className="h-4 w-4 text-sky-300" />}
            title="Potential Questions & Suggested Responses"
          >
            <QaEditor
              items={draft.questions}
              onChange={(questions) => update({ questions })}
            />
          </BriefCard>

          {/* 5. Important Facts */}
          <BriefCard icon={<Lightbulb className="h-4 w-4 text-amber-300" />} title="Important Facts">
            <StringListEditor
              items={draft.importantFacts}
              placeholder="Add an important fact"
              multiline
              onChange={(importantFacts) => update({ importantFacts })}
            />
          </BriefCard>

          {/* 6. Action Items */}
          <BriefCard icon={<ListChecks className="h-4 w-4 text-emerald-300" />} title="Action Items">
            <StringListEditor
              items={draft.actionItems}
              placeholder="Add an action item"
              multiline
              onChange={(actionItems) => update({ actionItems })}
            />
          </BriefCard>
        </div>
      )}
    </div>
  );
}

function BriefCard({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card p-5">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-300">
        {icon} {title}
      </h3>
      {children}
    </section>
  );
}

function StringListEditor({
  items,
  placeholder,
  multiline,
  onChange,
}: {
  items: string[];
  placeholder: string;
  multiline?: boolean;
  onChange: (items: string[]) => void;
}) {
  const [value, setValue] = useState('');

  const add = () => {
    if (!value.trim()) return;
    onChange([...items, value.trim()]);
    setValue('');
  };

  const edit = (index: number, text: string) =>
    onChange(items.map((item, i) => (i === index ? text : item)));

  const remove = (index: number) =>
    onChange(items.filter((_, i) => i !== index));

  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <div key={i} className="flex items-start gap-2">
          {multiline ? (
            <textarea
              className="input min-h-[44px] resize-y"
              value={item}
              onChange={(e) => edit(i, e.target.value)}
            />
          ) : (
            <input
              className="input"
              value={item}
              onChange={(e) => edit(i, e.target.value)}
            />
          )}
          <button
            className="btn-ghost mt-0.5 px-2 py-2 text-red-300 hover:bg-red-500/10"
            onClick={() => remove(i)}
            title="Remove"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
      <div className="flex gap-2">
        <input
          className="input"
          placeholder={placeholder}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <button className="btn-secondary" onClick={add}>
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function QaEditor({
  items,
  onChange,
}: {
  items: BriefQA[];
  onChange: (items: BriefQA[]) => void;
}) {
  const editField = (index: number, field: keyof BriefQA, text: string) =>
    onChange(
      items.map((qa, i) => (i === index ? { ...qa, [field]: text } : qa)),
    );

  const remove = (index: number) =>
    onChange(items.filter((_, i) => i !== index));

  const add = () =>
    onChange([...items, { question: '', response: '' }]);

  return (
    <div className="space-y-3">
      {items.map((qa, i) => (
        <div
          key={i}
          className="space-y-2 rounded-lg border border-surface-border bg-surface-muted/40 p-3"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Q{i + 1}
            </span>
            <button
              className="btn-ghost px-2 py-1 text-red-300 hover:bg-red-500/10"
              onClick={() => remove(i)}
              title="Remove"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <input
            className="input"
            placeholder="Potential question"
            value={qa.question}
            onChange={(e) => editField(i, 'question', e.target.value)}
          />
          <textarea
            className="input min-h-[60px] resize-y"
            placeholder="Suggested response"
            value={qa.response}
            onChange={(e) => editField(i, 'response', e.target.value)}
          />
        </div>
      ))}
      <button className="btn-secondary" onClick={add}>
        <Plus className="h-4 w-4" /> Add question
      </button>
    </div>
  );
}
