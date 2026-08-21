import { useState, useEffect } from 'react';
import { authService, workerService, jobService } from '../api/services';
import { Server, Clock, Activity, AlertTriangle, Plus, Trash2, Ticket } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

export default function WorkerStatus() {
  const [workers, setWorkers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [hostname, setHostname] = useState('worker-node-01');
  const [tickets, setTickets] = useState<any[]>([]);
  const [error, setError] = useState('');

  const fetchWorkers = async () => {
    try {
      const res = await workerService.list();
      setWorkers(res.data);
      try {
        const me = await authService.getMe();
        const admin = ['ADMIN', 'SUPER_ADMIN'].includes(me.role);
        setIsAdmin(admin);
        if (admin) setTickets((await jobService.adminTickets()).data);
      } catch { setIsAdmin(false); }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const addNode = async () => { try { await workerService.add(hostname); setHostname('worker-node-' + (workers.length + 1)); await fetchWorkers(); } catch (err: any) { setError(err.response?.data?.error?.message || 'Administrator permission required.'); } };
  const removeNode = async (id: string) => { try { const result = await workerService.remove(id); setError(`Node deleted. ${result.reclaimedJobs || 0} active job(s) returned to the queue.`); await fetchWorkers(); } catch (err: any) { setError(err.response?.data?.error?.message || 'Unable to delete worker node.'); } };
  const deleteTicketJob = async (id: string) => { try { await jobService.adminDelete(id); await fetchWorkers(); } catch (err: any) { setError(err.response?.data?.error?.message || 'Unable to delete job.'); } };

  useEffect(() => {
    fetchWorkers();
    const interval = setInterval(fetchWorkers, 3000);
    return () => clearInterval(interval);
  }, []);

  if (loading) return <div className="flex h-full items-center justify-center">Loading...</div>;

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold leading-7 text-slate-900 sm:truncate sm:text-3xl sm:tracking-tight">
          Worker Nodes
        </h2>
        {error && <div role="alert" className="mt-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        {isAdmin && <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex flex-col justify-between gap-4 md:flex-row md:items-center"><div><h3 className="font-bold text-slate-950">Administrator controls</h3><p className="mt-1 text-xs text-slate-500">Register a node placeholder for deployment planning or remove an idle node.</p></div><div className="flex gap-2"><input value={hostname} onChange={(event) => setHostname(event.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm" /><button type="button" onClick={addNode} className="inline-flex items-center gap-2 rounded-lg bg-sky-700 px-3 py-2 text-sm font-bold text-white"><Plus className="h-4 w-4" />Add node</button></div></div></section>}
        <p className="mt-1 text-sm text-slate-500">Live view of all active and stale worker processes.</p>
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {workers.map((worker) => {
          // A worker is considered stale/dead if we haven't seen a heartbeat in > 15 seconds
          const isStale = new Date(worker.lastSeenAt).getTime() < Date.now() - 15000;
          
          return (
            <div key={worker.id} className={`flex flex-col justify-between overflow-hidden rounded-xl shadow-sm ring-1 ${isStale ? 'bg-red-50 ring-red-200' : 'bg-white ring-slate-900/5'}`}>
              <div>
                <div className={`border-b px-6 py-4 flex items-center justify-between ${isStale ? 'border-red-200' : 'border-slate-200 bg-slate-50'}`}>
                  <h3 className="text-base font-semibold leading-6 text-slate-900 flex items-center">
                    <Server className={`mr-2 h-5 w-5 ${isStale ? 'text-red-500' : 'text-slate-400'}`} />
                    <span className="truncate w-36" title={worker.id}>{worker.hostname || worker.id}</span>
                  </h3>
                  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${isStale ? 'bg-red-100 text-red-800' : 'bg-emerald-100 text-emerald-800'}`}>
                    {isStale ? 'DEAD' : worker.status}
                  </span>
                </div>
                <div className="px-6 py-5">
                  <dl className="space-y-4">
                    <div className="flex justify-between">
                      <dt className="text-sm font-medium text-slate-500 flex items-center">
                        <Clock className="mr-2 h-4 w-4" /> Last Seen
                      </dt>
                      <dd className={`text-sm ${isStale ? 'text-red-600 font-bold' : 'text-slate-900'}`}>
                        {formatDistanceToNow(new Date(worker.lastSeenAt), { addSuffix: true })}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-sm font-medium text-slate-500 flex items-center">
                        <Activity className="mr-2 h-4 w-4" /> Active Jobs
                      </dt>
                      <dd className="text-sm text-slate-900 font-semibold">{worker.activeJobCount}</dd>
                    </div>
                  </dl>
                  {isStale && (
                    <div className="mt-4 flex items-start rounded-md bg-red-100 p-3">
                      <AlertTriangle className="h-5 w-5 text-red-600 mr-2 shrink-0" />
                      <p className="text-xs text-red-800">
                        This worker missed multiple heartbeats and is likely dead. The worker reaper returns its unfinished work to the queue for another live node.
                      </p>
                    </div>
                  )}
                </div>
              </div>
              <div className="border-t border-slate-100 bg-slate-50/50 px-6 py-3 flex justify-end">
                <button
                  type="button"
                  onClick={() => removeNode(worker.id)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-bold text-rose-600 transition-colors hover:bg-rose-50 hover:text-rose-700 shadow-sm"
                  title="Delete worker node"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete Node
                </button>
              </div>
            </div>
          );
        })}
        {workers.length === 0 && (
          <div className="col-span-full py-12 text-center border-2 border-dashed border-slate-300 rounded-xl">
            <Server className="mx-auto h-12 w-12 text-slate-300" />
            <h3 className="mt-2 text-sm font-semibold text-slate-900">No workers found</h3>
            <p className="mt-1 text-sm text-slate-500">Start a worker process using <code className="bg-slate-100 px-1 py-0.5 rounded">npm run worker:start</code></p>
          </div>
        )}
      </div>
      {isAdmin && tickets.length > 0 && <section className="rounded-2xl border border-rose-200 bg-rose-50/60 p-5"><div className="flex items-center gap-2 font-bold text-rose-950"><Ticket className="h-4 w-4" />Open job tickets</div><div className="mt-4 space-y-2">{tickets.map((ticket) => <div key={ticket.id} className="flex flex-col justify-between gap-3 rounded-xl border border-white bg-white p-4 sm:flex-row sm:items-center"><div><p className="text-sm font-bold text-slate-900">{ticket.job.type} <span className="font-mono text-xs text-slate-400">#{ticket.jobId.slice(0, 6)}</span></p><p className="mt-1 text-xs text-slate-500">{ticket.reason}</p></div><button type="button" onClick={() => deleteTicketJob(ticket.jobId)} className="inline-flex items-center gap-2 rounded-lg bg-rose-700 px-3 py-2 text-xs font-bold text-white"><Trash2 className="h-3.5 w-3.5" />Delete job</button></div>)}</div></section>}
    </div>
  );
}
