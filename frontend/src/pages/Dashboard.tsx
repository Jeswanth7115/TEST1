import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { orgService, projectService, queueService } from '../api/services';
import { Folder, Database, Plus, Trash2 } from 'lucide-react';

export default function Dashboard() {
  const [orgs, setOrgs] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [queues, setQueues] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
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
    } catch (err) {
      console.error("Failed to load dashboard data", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

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

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold leading-7 text-slate-900 sm:truncate sm:text-3xl sm:tracking-tight">
          Dashboard
        </h2>
      </div>

      {errorMsg && (
        <div className="rounded-md bg-red-50 p-4 text-sm text-red-700 flex justify-between items-center">
          <span>{errorMsg}</span>
          <button onClick={() => setErrorMsg('')} className="font-bold">✕</button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Projects Section */}
        <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-900/5">
          <div className="border-b border-slate-200 bg-slate-50 px-6 py-4 flex items-center justify-between">
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
        <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-900/5">
          <div className="border-b border-slate-200 bg-slate-50 px-6 py-4 flex items-center justify-between">
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
