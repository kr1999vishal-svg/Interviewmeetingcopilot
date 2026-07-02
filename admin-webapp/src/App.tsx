import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Settings from './pages/Settings';
import Users from './pages/Users';
import Payment from './pages/Payment';
import { Settings as SettingsIcon, Users as UsersIcon, BarChart3, CreditCard } from 'lucide-react';

function App() {
  return (
    <Router>
      <div className="min-h-screen bg-gray-900 text-white">
        <nav className="bg-gray-800 border-b border-gray-700">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between h-16">
              <div className="flex items-center">
                <span className="text-xl font-bold text-indigo-400">Interview AI - Admin</span>
              </div>
              <div className="flex space-x-4">
                <Link to="/" className="flex items-center px-3 py-2 rounded-md text-sm font-medium hover:bg-gray-700">
                  <BarChart3 className="w-4 h-4 mr-2" />
                  Dashboard
                </Link>
                <Link to="/settings" className="flex items-center px-3 py-2 rounded-md text-sm font-medium hover:bg-gray-700">
                  <SettingsIcon className="w-4 h-4 mr-2" />
                  Settings
                </Link>
                <Link to="/users" className="flex items-center px-3 py-2 rounded-md text-sm font-medium hover:bg-gray-700">
                  <UsersIcon className="w-4 h-4 mr-2" />
                  Users
                </Link>
                <Link to="/payment" className="flex items-center px-3 py-2 rounded-md text-sm font-medium hover:bg-gray-700">
                  <CreditCard className="w-4 h-4 mr-2" />
                  Payment
                </Link>
              </div>
            </div>
          </div>
        </nav>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/users" element={<Users />} />
          <Route path="/payment" element={<Payment />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
