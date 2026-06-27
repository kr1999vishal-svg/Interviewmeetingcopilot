import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  CalendarClock,
  Plus,
  Radio,
  Trash2,
  Users,
  CheckCircle2,
  Clock,
  Search,
  Tag,
  SearchX,
} from 'lucide-react';
import { storage } from '@/lib/storage';
import type { Meeting } from '@/types';
import { meetingTypeLabel } from '@/types';
import { EmptyState, PageHeader, Spinner, StatusBadge } from '@/components/ui';
import { formatDateTime } from '@/lib/format';

export default function Dashboard() {
  const navigate = useNavigate();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => {
      setMeetings(storage.getMeetings());
      setLoading(false);
    }, 200);
    return () => clearTimeout(timer);
  }, []);

  // Most recently created first.
  const recentMeetings = useMemo(
    () => [...meetings].sort((a, b) => b.createdAt - a.createdAt),
    [meetings],
  );

  // Filter by title, meeting type, or description.
  const filteredMeetings = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return recentMeetings;
    return recentMeetings.filter((m) =>
      [m.title, meetingTypeLabel(m.type ?? 'other'), m.description ?? '']
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }, [recentMeetings, query]);

  const stats = useMemo(() => {
    return {
      total: meetings.length,
      upcoming: meetings.filter((m) => m.status === 'scheduled').length,
      completed: meetings.filter((m) => m.status === 'completed').length,
    };
  }, [meetings]);

  const handleDelete = (id: string) => {
    storage.deleteMeeting(id);
    setMeetings(storage.getMeetings());
  };

  const destinationFor = (m: Meeting): string => {
    if (m.status === 'completed') return `/meetings/${m.id}/summary`;
    if (m.status === 'live') return `/meetings/${m.id}/live`;
    return `/meetings/${m.id}/context`;
  };

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Your meetings at a glance."
        actions={
          <Link to="/create" className="btn-primary">
            <Plus className="h-4 w-4" /> New Meeting
          </Link>
        }
      />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard icon={<CalendarClock className="h-5 w-5" />} label="Total" value={stats.total} />
        <StatCard icon={<Clock className="h-5 w-5" />} label="Upcoming" value={stats.upcoming} />
        <StatCard icon={<CheckCircle2 className="h-5 w-5" />} label="Completed" value={stats.completed} />
      </div>

      {loading ? (
        <Spinner label="Loading meetings..." />
      ) : meetings.length === 0 ? (
        <EmptyState
          icon={<Radio className="h-10 w-10" />}
          title="No meetings yet"
          description="Create your first meeting to start capturing context, live notes, and summaries."
          action={
            <Link to="/create" className="btn-primary">
              <Plus className="h-4 w-4" /> Create Meeting
            </Link>
          }
        />
      ) : (
        <>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-lg font-semibold text-white">
              Recent Meetings
              <span className="ml-2 text-sm font-normal text-slate-500">
                ({filteredMeetings.length})
              </span>
            </h2>
            <div className="relative w-full sm:max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input
                className="input pl-9"
                placeholder="Search by title or type..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>

          {filteredMeetings.length === 0 ? (
            <EmptyState
              icon={<SearchX className="h-10 w-10" />}
              title="No matching meetings"
              description={`No meetings match "${query}". Try a different search.`}
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {filteredMeetings.map((m) => (
            <div
              key={m.id}
              className="card group cursor-pointer p-5 transition hover:border-brand-600"
              onClick={() => navigate(destinationFor(m))}
            >
              <div className="mb-3 flex items-start justify-between gap-3">
                <h3 className="font-semibold text-white">{m.title}</h3>
                <StatusBadge status={m.status} />
              </div>
              {m.description && (
                <p className="mb-4 line-clamp-2 text-sm text-slate-400">
                  {m.description}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-4 text-xs text-slate-400">
                <span className="badge bg-brand-600/15 text-brand-300">
                  <Tag className="h-3 w-3" />
                  {meetingTypeLabel(m.type ?? 'other')}
                </span>
                <span className="flex items-center gap-1.5">
                  <CalendarClock className="h-3.5 w-3.5" />
                  Created {formatDateTime(m.createdAt)}
                </span>
                <span className="flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5" />
                  {m.participants.length} participant(s)
                </span>
              </div>
              <div className="mt-4 flex items-center justify-end border-t border-surface-border pt-3">
                <button
                  className="btn-ghost px-2 py-1 text-red-300 hover:bg-red-500/10"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(m.id);
                  }}
                >
                  <Trash2 className="h-4 w-4" /> Delete
                </button>
              </div>
            </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <div className="card flex items-center gap-4 p-5">
      <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-brand-600/15 text-brand-300">
        {icon}
      </span>
      <div>
        <p className="text-2xl font-bold text-white">{value}</p>
        <p className="text-xs text-slate-400">{label}</p>
      </div>
    </div>
  );
}
