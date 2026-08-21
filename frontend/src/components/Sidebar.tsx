import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Activity, LogOut, Boxes, KanbanSquare, ShieldAlert } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: (string | undefined | null | false)[]) {
  return twMerge(clsx(inputs));
}

export default function Sidebar() {
  const location = useLocation();

  const handleLogout = () => {
    localStorage.removeItem('token');
    window.location.href = '/login';
  };

  const navItems = [
    { name: 'Projects', href: '/projects', icon: LayoutDashboard },
    { name: 'Simulation board', href: '/simulation', icon: KanbanSquare },
    { name: 'Workers', href: '/workers', icon: Activity },
  ];

  return (
    <aside className="sticky top-0 flex h-screen w-72 shrink-0 flex-col bg-[#132536] text-slate-300 shadow-[12px_0_30px_rgba(16,35,51,0.08)]">
      <div className="border-b border-white/10 px-7 py-7">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#e6b86a] text-[#132536] shadow-lg shadow-black/10">
            <Boxes className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-base font-bold tracking-tight text-white">Dispatch</h1>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">Job Scheduler</p>
          </div>
        </div>
      </div>
      <nav aria-label="Primary navigation" className="flex-1 space-y-2 px-4 py-7">
        <p className="px-3 pb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Workspace</p>
        {navItems.map((item) => {
          const isActive = location.pathname.startsWith(item.href);
          return (
            <Link
              key={item.name}
              to={item.href}
              className={cn(
                'group flex items-center rounded-xl px-3 py-3 text-sm font-semibold transition-colors',
                isActive
                  ? 'bg-white/10 text-white shadow-inner shadow-white/5'
                  : 'text-slate-400 hover:bg-white/5 hover:text-white'
              )}
            >
              <item.icon
                className={cn(
                  'mr-3 h-[18px] w-[18px] flex-shrink-0',
                  isActive ? 'text-[#e6b86a]' : 'text-slate-500 group-hover:text-slate-200'
                )}
                aria-hidden="true"
              />
              {item.name}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-white/10 p-4 space-y-1">
        <a
          href="http://localhost:5174"
          target="_blank"
          rel="noopener noreferrer"
          className="group flex w-full items-center rounded-xl px-3 py-3 text-sm font-semibold text-slate-400 transition-colors hover:bg-white/5 hover:text-white"
        >
          <ShieldAlert className="mr-3 h-[18px] w-[18px] text-slate-500 group-hover:text-[#e6b86a]" aria-hidden="true" />
          Administration
        </a>
        <button
          onClick={handleLogout}
          className="group flex w-full items-center rounded-xl px-3 py-3 text-sm font-semibold text-slate-400 transition-colors hover:bg-white/5 hover:text-white"
        >
          <LogOut className="mr-3 h-[18px] w-[18px] text-slate-500 group-hover:text-[#e6b86a]" aria-hidden="true" />
          Log out
        </button>
      </div>
    </aside>
  );
}
