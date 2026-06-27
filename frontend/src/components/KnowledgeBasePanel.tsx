import { useState } from 'react';
import {
  Brain,
  RefreshCw,
  Users,
  Target,
  AlertTriangle,
  MessageSquare,
  Hash,
  FileText,
  Code2,
  Copy,
  Check,
} from 'lucide-react';
import type { KnowledgeBase } from '@/types';
import { formatDateTime } from '@/lib/format';

interface KnowledgeBasePanelProps {
  knowledgeBase?: KnowledgeBase;
  generating: boolean;
  onGenerate: () => void;
}

export default function KnowledgeBasePanel({
  knowledgeBase,
  generating,
  onGenerate,
}: KnowledgeBasePanelProps) {
  const [showJson, setShowJson] = useState(false);
  const [copied, setCopied] = useState(false);

  const copyJson = async () => {
    if (!knowledgeBase) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(knowledgeBase, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="card mb-6 p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-300">
          <Brain className="h-4 w-4 text-brand-300" /> Knowledge Base
        </h3>
        <div className="flex items-center gap-2">
          {knowledgeBase && (
            <button
              className="btn-ghost px-2 py-1.5 text-xs"
              onClick={() => setShowJson((v) => !v)}
              title="Toggle raw JSON"
            >
              <Code2 className="h-3.5 w-3.5" /> {showJson ? 'View' : 'JSON'}
            </button>
          )}
          <button
            className="btn-primary px-3 py-1.5 text-xs"
            onClick={onGenerate}
            disabled={generating}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${generating ? 'animate-spin' : ''}`} />
            {generating
              ? 'Generating...'
              : knowledgeBase
                ? 'Regenerate'
                : 'Generate'}
          </button>
        </div>
      </div>

      {!knowledgeBase ? (
        <p className="rounded-lg border border-dashed border-surface-border py-8 text-center text-sm text-slate-500">
          Generate a structured knowledge base from your context notes, uploaded
          documents, and meeting details.
        </p>
      ) : showJson ? (
        <div className="relative">
          <button
            onClick={copyJson}
            className="btn-ghost absolute right-2 top-2 px-2 py-1 text-xs"
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-400" /> Copied
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" /> Copy
              </>
            )}
          </button>
          <pre className="max-h-96 overflow-auto rounded-lg bg-surface-muted p-4 text-xs leading-relaxed text-slate-300">
            {JSON.stringify(knowledgeBase, null, 2)}
          </pre>
        </div>
      ) : (
        <div className="space-y-5">
          <Section icon={<FileText className="h-4 w-4 text-brand-300" />} title="Summary">
            <p className="text-sm leading-relaxed text-slate-200">
              {knowledgeBase.meetingSummary}
            </p>
          </Section>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <Section
              icon={<Users className="h-4 w-4 text-sky-300" />}
              title={`Participants (${knowledgeBase.participants.length})`}
            >
              <ListOrEmpty
                empty="No participants listed."
                items={knowledgeBase.participants.map((p) =>
                  p.role ? `${p.name} — ${p.role}` : p.name,
                )}
              />
            </Section>

            <Section
              icon={<Target className="h-4 w-4 text-emerald-300" />}
              title={`Goals (${knowledgeBase.goals.length})`}
            >
              <ListOrEmpty empty="No goals detected." items={knowledgeBase.goals} />
            </Section>
          </div>

          <Section
            icon={<AlertTriangle className="h-4 w-4 text-amber-300" />}
            title={`Risks (${knowledgeBase.risks.length})`}
          >
            <ListOrEmpty
              empty="No risks flagged."
              items={knowledgeBase.risks}
              tone="risk"
            />
          </Section>

          <Section
            icon={<MessageSquare className="h-4 w-4 text-brand-300" />}
            title={`Talking Points (${knowledgeBase.talkingPoints.length})`}
          >
            <ListOrEmpty
              empty="No talking points yet."
              items={knowledgeBase.talkingPoints}
            />
          </Section>

          <Section icon={<Hash className="h-4 w-4 text-violet-300" />} title="Key Topics">
            {knowledgeBase.keyTopics.length === 0 ? (
              <p className="text-sm text-slate-500">No topics detected.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {knowledgeBase.keyTopics.map((topic) => (
                  <span
                    key={topic}
                    className="badge bg-violet-500/15 text-violet-200"
                  >
                    {topic}
                  </span>
                ))}
              </div>
            )}
          </Section>

          <Section
            icon={<FileText className="h-4 w-4 text-slate-400" />}
            title={`Supporting Documents (${knowledgeBase.supportingDocuments.length})`}
          >
            {knowledgeBase.supportingDocuments.length === 0 ? (
              <p className="text-sm text-slate-500">No documents attached.</p>
            ) : (
              <ul className="space-y-2">
                {knowledgeBase.supportingDocuments.map((doc) => (
                  <li
                    key={doc.id}
                    className="rounded-lg bg-surface-muted px-3 py-2.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-slate-100">
                        {doc.name}
                      </span>
                      <span className="shrink-0 text-xs text-slate-500">
                        {doc.type.toUpperCase()} · {doc.wordCount} words
                      </span>
                    </div>
                    {doc.excerpt && (
                      <p className="mt-1 line-clamp-2 text-xs text-slate-400">
                        {doc.excerpt}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <p className="text-right text-xs text-slate-500">
            Generated {formatDateTime(knowledgeBase.generatedAt)}
          </p>
        </div>
      )}
    </div>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h4 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
        {icon} {title}
      </h4>
      {children}
    </div>
  );
}

function ListOrEmpty({
  items,
  empty,
  tone,
}: {
  items: string[];
  empty: string;
  tone?: 'risk';
}) {
  if (items.length === 0) {
    return <p className="text-sm text-slate-500">{empty}</p>;
  }
  return (
    <ul className="space-y-1.5">
      {items.map((item, i) => (
        <li
          key={i}
          className={`flex gap-2 rounded-lg px-3 py-2 text-sm ${
            tone === 'risk'
              ? 'bg-amber-500/10 text-amber-100'
              : 'bg-surface-muted text-slate-200'
          }`}
        >
          <span className="text-slate-500">•</span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}
