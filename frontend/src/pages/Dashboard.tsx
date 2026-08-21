import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { orgService, projectService, queueService } from '../api/services';
import { Folder, Database, Plus, Trash2, RefreshCw, Activity, PauseCircle } from 'lucide-react';

interface Project {
  id: string;
  name: string;
}

interface Queue {
  id: string;
  name: string;
  priority: number;
  concurrencyLimit: number;
  isPaused: boolean;
}

export default function Dashboard() {
  const [orgs, setOrgs] = useState<{ id: string }[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [queues, setQueues] = useState<Queue[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string>('');

  // Modal states
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [showQueueModal, setShowQueueModal] = useState(false);
  const [newQueueName, setNewQueueName] = useState('');

  const loadData = async (targetProjectId?: string) => {
    try {
      setErrorMsg('');
      const orgsData = await orgService.list();
      setOrgs(orgsData.data);
      
      if (orgsData.data.length > 0) {
        const orgId = orgsData.data[0].id;
        const projectsData = await projectService.list(orgId);
        setProjects(projectsData.data);

        const currentProjId = targetProjectId || selectedProjectId || (projectsData.data.length > 0 ? projectsData.data[0].id : '');
        setSelectedProjectId(currentProjId);

        if (currentProjId) {
          const queuesData = await queueService.list(currentProjId);
          setQueues(queuesData.data);
        } else {
          setQueues([]);
        }
      }
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error?.message || 'Unable to load workspace data. Try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleRefresh = () => {
    setRefreshing(true);
    loadData(selectedProjectId);
  };

  const handleSelectProject = async (projId: string) => {
    setSelectedProjectId(projId);
    try {
      const queuesData = await queueService.list(projId);
      setQueues(queuesData.data);
    } catch (err) {
      console.error("Failed to load queues for project", err);
    }
  };

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectName || orgs.length === 0) return;
    try {
      const created = await projectService.create(orgs[0].id, newProjectName);
      setNewProjectName('');
      setShowProjectModal(false);
      await loadData(created.id);
    } catch (err) {
      console.error("Failed to create project", err);
    }
  };

  const handleDeleteProject = async (e: React.MouseEvent, projId: string) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this project? All associated queues and jobs will be removed.')) return;
    try {
      await projectService.delete(projId);
      await loadData();
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error?.message || 'Failed to delete project');
    }
  };

  const handleCreateQueue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newQueueName || !selectedProjectId) return;
    try {
      await queueService.create(selectedProjectId, newQueueName);
      setNewQueueName('');
      setShowQueueModal(false);
      await loadData(selectedProjectId);
    } catch (err) {
      console.error("Failed to create queue", err);
    }
  };

  const handleDeleteQueue = async (e: React.MouseEvent, queueId: string) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this queue?')) return;
    try {
      await queueService.delete(queueId);
      await loadData(selectedProjectId);
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error?.message || 'Failed to delete queue');
    }
  };

  if (loading) {
    return <div className="flex h-full items-center justify-center">Loading...</div>;
  }

  const pausedQueues = queues.filter((queue) => queue.isPaused).length;

  return (
    <div className="space-y-8">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-semibold text-sky-700">Workspace overview</p>
          <h2 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Project operations</h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">Keep delivery moving with a clear view of projects, queue capacity, and paused workloads.</p>
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh data
        </button>
      </div>

      {errorMsg && (
        <div role="alert" className="flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span>{errorMsg}</span>
          <button aria-label="Dismiss error" onClick={() => setErrorMsg('')} className="rounded-lg px-2 py-1 font-bold hover:bg-red-100">&times;</button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between"><span className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Projects</span><Folder className="h-4 w-4 text-sky-700" /></div>
          <p className="mt-4 text-3xl font-bold text-slate-950">{projects.length}</p>
          <p className="mt-1 text-xs text-slate-500">Active workspaces</p>
        </div>
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between"><span className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Queues</span><Activity className="h-4 w-4 text-emerald-600" /></div>
          <p className="mt-4 text-3xl font-bold text-slate-950">{queues.length}</p>
          <p className="mt-1 text-xs text-slate-500">{queues.length - pausedQueues} ready to process</p>
        </div>
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between"><span className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Paused</span><PauseCircle className="h-4 w-4 text-amber-600" /></div>
          <p className="mt-4 text-3xl font-bold text-slate-950">{pausedQueues}</p>
          <p className="mt-1 text-xs text-slate-500">Queues needing attention</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Projects Section */}
        <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/70 px-6 py-5">
            <h3 className="text-base font-semibold leading-6 text-slate-900 flex items-center">
              <Folder className="mr-2 h-5 w-5 text-slate-400" />
              Projects
            </h3>
            <button
              onClick={() => setShowProjectModal(true)}
              className="text-sm font-medium text-blue-600 hover:text-blue-500 flex items-center"
            >
              <Plus className="h-4 w-4 mr-1" /> New
            </button>
          </div>
          <ul className="divide-y divide-slate-100">
            {projects.map((project) => {
              const isSelected = project.id === selectedProjectId;
              return (
                <li 
                  key={project.id} 
                  onClick={() => handleSelectProject(project.id)}
                  className={`flex justify-between items-center gap-x-6 px-6 py-5 cursor-pointer transition-colors ${isSelected ? 'bg-blue-50/60 border-l-4 border-blue-600' : 'hover:bg-slate-50'}`}
                >
                  <div className="min-w-0 flex-auto">
                    <p className="text-sm font-semibold leading-6 text-slate-900">{project.name}</p>
                    <p className="mt-1 truncate text-xs leading-5 text-slate-500">ID: {project.id}</p>
                  </div>
                  <button
                    onClick={(e) => handleDeleteProject(e, project.id)}
                    title="Delete Project"
                    className="text-slate-400 hover:text-red-600 p-1.5 rounded-lg hover:bg-red-50 transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              );
            })}
            {projects.length === 0 && (
              <li className="px-6 py-5 text-sm text-slate-500 text-center">No projects found. Click "+ New" to add one!</li>
            )}
          </ul>
        </div>

        {/* Queues Section */}
        <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/70 px-6 py-5">
            <h3 className="text-base font-semibold leading-6 text-slate-900 flex items-center">
              <Database className="mr-2 h-5 w-5 text-slate-400" />
              Queues {selectedProjectId ? `(Selected Project)` : ''}
            </h3>
            <button
              onClick={() => setShowQueueModal(true)}
              disabled={!selectedProjectId}
              className="text-sm font-medium text-blue-600 hover:text-blue-500 flex items-center disabled:opacity-50"
            >
              <Plus className="h-4 w-4 mr-1" /> New
            </button>
          </div>
          <ul className="divide-y divide-slate-100">
            {queues.map((queue) => (
              <li key={queue.id} className="px-6 py-5 hover:bg-slate-50 flex items-center justify-between">
                <Link to={`/queues/${queue.id}`} className="block flex-1 min-w-0 mr-4">
                  <div className="min-w-0 flex-auto">
                    <p className="text-sm font-semibold leading-6 text-slate-900">{queue.name}</p>
                    <div className="mt-1 flex items-center gap-x-2 text-xs leading-5 text-slate-500">
                      <span>Priority: {queue.priority}</span>
                      <span>&middot;</span>
                      <span>Concurrency: {queue.concurrencyLimit}</span>
                      <span>&middot;</span>
                      <span className={queue.isPaused ? "text-amber-600 font-medium" : "text-emerald-600 font-medium"}>
                        {queue.isPaused ? 'Paused' : 'Active'}
                      </span>
                    </div>
                  </div>
                </Link>
                <button
                  onClick={(e) => handleDeleteQueue(e, queue.id)}
                  title="Delete Queue"
                  className="text-slate-400 hover:text-red-600 p-1.5 rounded-lg hover:bg-red-50 transition-colors"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
            {queues.length === 0 && (
              <li className="px-6 py-5 text-sm text-slate-500 text-center">
                {selectedProjectId ? 'No queues found in this project. Click "+ New" to add one!' : 'Select a project to view its queues.'}
              </li>
            )}
          </ul>
        </div>
      </div>

      {/* New Project Modal */}
      {showProjectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-bold text-slate-900">Create New Project</h3>
            <form onSubmit={handleCreateProject} className="mt-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700">Project Name</label>
                <input
                  type="text"
                  required
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  placeholder="e.g. Production Pipeline"
                  className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div className="flex justify-end gap-x-3">
                <button
                  type="button"
                  onClick={() => setShowProjectModal(false)}
                  className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
                >
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* New Queue Modal */}
      {showQueueModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-bold text-slate-900">Create New Queue</h3>
            <form onSubmit={handleCreateQueue} className="mt-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700">Queue Name</label>
                <input
                  type="text"
                  required
                  value={newQueueName}
                  onChange={(e) => setNewQueueName(e.target.value)}
                  placeholder="e.g. email-queue"
                  className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div className="flex justify-end gap-x-3">
                <button
                  type="button"
                  onClick={() => setShowQueueModal(false)}
                  className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
                >
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
