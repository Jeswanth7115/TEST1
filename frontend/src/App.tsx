import { useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import QueueDetail from './pages/QueueDetail';
import JobExplorer from './pages/JobExplorer';
import WorkerStatus from './pages/WorkerStatus';

function App() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('token'));

  const handleLoginSuccess = (newToken: string) => {
    localStorage.setItem('token', newToken);
    setToken(newToken);
  };

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login onLoginSuccess={handleLoginSuccess} />} />
        
        {/* Protected Routes */}
        <Route path="/" element={token ? <Layout /> : <Navigate to="/login" replace />}>
          <Route index element={<Navigate to="/projects" replace />} />
          <Route path="projects" element={<Dashboard />} />
          <Route path="queues/:queueId" element={<QueueDetail />} />
          <Route path="queues/:queueId/jobs" element={<JobExplorer />} />
          <Route path="workers" element={<WorkerStatus />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
