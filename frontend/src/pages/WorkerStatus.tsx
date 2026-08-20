import { useState, useEffect } from 'react';
import { workerService } from '../api/services';
import { Server, Clock, Activity, AlertTriangle } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

export default function WorkerStatus() {
  const [workers, setWorkers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchWorkers = async () => {
    try {
      const res = await workerService.list();
      setWorkers(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

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
        <p className="mt-1 text-sm text-slate-500">Live view of all active and stale worker processes.</p>
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {workers.map((worker) => {
          // A worker is considered stale/dead if we haven't seen a heartbeat in > 15 seconds
          const isStale = new Date(worker.lastSeenAt).getTime() < Date.now() - 15000;
          
          return (
            <div key={worker.id} className={`overflow-hidden rounded-xl shadow-sm ring-1 ${isStale ? 'bg-red-50 ring-red-200' : 'bg-white ring-slate-900/5'}`}>
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
                    <AlertTriangle className="h-5 w-5 text-red-600 mr-2" />
                    <p className="text-xs text-red-800">
                      This worker missed multiple heartbeats and is likely dead. Any jobs it was processing will remain stuck in CLAIMED or RUNNING unless manually recovered.
                    </p>
                  </div>
                )}
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
    </div>
  );
}
