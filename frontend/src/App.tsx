import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from '@/components/Layout';
import Dashboard from '@/pages/Dashboard';
import CreateMeeting from '@/pages/CreateMeeting';
import PreMeetingContext from '@/pages/PreMeetingContext';
import LiveMeeting from '@/pages/LiveMeeting';
import MeetingSummary from '@/pages/MeetingSummary';
import MeetingBriefPage from '@/pages/MeetingBriefPage';
import Settings from '@/pages/Settings';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/create" element={<CreateMeeting />} />
        <Route path="/meetings/:id/context" element={<PreMeetingContext />} />
        <Route path="/meetings/:id/live" element={<LiveMeeting />} />
        <Route path="/meetings/:id/brief" element={<MeetingBriefPage />} />
        <Route path="/meetings/:id/summary" element={<MeetingSummary />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
