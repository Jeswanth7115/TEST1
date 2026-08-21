import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';

export default function Layout() {
  const [now, setNow] = useState(new Date());
  const [timezone, setTimezone] = useState(() => localStorage.getItem('timezone') || Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('theme') === 'dark');

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    localStorage.setItem('theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

  const formatClock = (zone: string) => new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(now);

  return (
    <div className="app-shell flex min-h-screen bg-transparent dark:text-slate-100">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="app-header flex h-20 shrink-0 items-center justify-between border-b border-slate-200/80 bg-white/85 px-8 backdrop-blur md:px-10">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-sky-700">Operations console</p>
            <p className="mt-1 text-sm text-slate-500">Monitor work, workers, and delivery health</p>
          </div>
          <div className="hidden items-center gap-4 sm:flex">
            <div className="text-right"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">UTC</p><p className="font-mono text-xs font-semibold text-slate-700 dark:text-slate-200">{formatClock('UTC')}</p></div>
            <div className="border-l border-slate-200 pl-4 dark:border-slate-700"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{timezone}</p><p className="font-mono text-xs font-semibold text-slate-700 dark:text-slate-200">{formatClock(timezone)}</p></div>
            <select aria-label="Display timezone" value={timezone} onChange={(event) => { setTimezone(event.target.value); localStorage.setItem('timezone', event.target.value); }} className="max-w-[150px] rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"><option value="UTC">UTC</option><option value="America/New_York">New York</option><option value="Europe/London">London</option><option value="Asia/Kolkata">Mumbai</option><option value="Asia/Tokyo">Tokyo</option><option value="Australia/Sydney">Sydney</option></select>
            <button type="button" aria-label={darkMode ? 'Use light theme' : 'Use dark theme'} title={darkMode ? 'Use light theme' : 'Use dark theme'} onClick={() => setDarkMode((value) => !value)} className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700">{darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}</button>
            <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.12)]" />
            <span className="text-xs font-semibold text-slate-600">System operational</span>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto px-8 py-8 md:px-10">
          <div className="page-content"><Outlet /></div>
        </main>
      </div>
    </div>
  );
}
