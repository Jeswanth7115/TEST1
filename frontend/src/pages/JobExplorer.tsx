import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { jobService } from '../api/services';
import { RefreshCw, Filter, XCircle, AlertCircle } from 'lucide-react';
import { format } from 'date-fns';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: (string | undefined | null | false)[]) {
  return twMerge(clsx(inputs));
}

const statusColors: Record<string, string> = {
  QUEUED: 'bg-blue-100 text-blue-700',
  SCHEDULED: 'bg-purple-100 text-purple-700',
  CLAIMED: 'bg-indigo-100 text-indigo-700',
  RUNNING: 'bg-emerald-100 text-emerald-700',
  COMPLETED: 'bg-slate-100 text-slate-700',
  FAILED: 'bg-red-100 text-red-700',
  DEAD_LETTER: 'bg-red-900 text-white',
};

export default function JobExplorer() {
  const { queueId } = useParams();
  const [jobs, setJobs] = useState<any[]>([]);
  const [meta, setMeta] = useState<any>(null);
  
  // Filters
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  
  const [selectedJob, setSelectedJob] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const fetchJobs = async () => {
    if (!queueId) return;
    try {
      const res = await jobService.list(queueId, {
        page,
        limit: 15,
        status: statusFilter || undefined,
        type: typeFilter || undefined
      });
      setJobs(res.data);
      setMeta(res.meta);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();
    const interval = setInterval(fetchJobs, 5000);
    return () => clearInterval(interval);
  }, [queueId, page, statusFilter, typeFilter]);

  const loadJobDetail = async (jobId: string) => {
    try {
      const detail = await jobService.get(jobId);
      setSelectedJob(detail);
    } catch (err) {
      console.error(err);
    }
  };

  const handleRetry = async (jobId: string) => {
    try {
      await jobService.retry(jobId);
      fetchJobs();
      if (selectedJob?.id === jobId) {
        loadJobDetail(jobId);
      }
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold leading-7 text-slate-900 sm:truncate sm:text-3xl sm:tracking-tight">
          Job Explorer
        </h2>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 bg-white p-4 rounded-xl shadow-sm ring-1 ring-slate-900/5">
        <Filter className="h-5 w-5 text-slate-400" />
        <select 
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="rounded-md border-0 py-1.5 pl-3 pr-10 text-slate-900 ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-blue-600 sm:text-sm sm:leading-6"
        >
          <option value="">All Statuses</option>
          <option value="QUEUED">QUEUED</option>
          <option value="SCHEDULED">SCHEDULED</option>
          <option value="CLAIMED">CLAIMED</option>
          <option value="RUNNING">RUNNING</option>
          <option value="COMPLETED">COMPLETED</option>
          <option value="FAILED">FAILED</option>
          <option value="DEAD_LETTER">DEAD_LETTER</option>
        </select>
        
        <input 
          type="text" 
          placeholder="Filter by type..."
          value={typeFilter}
          onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
          className="rounded-md border-0 py-1.5 px-3 text-slate-900 ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-blue-600 sm:text-sm sm:leading-6"
        />

        <button onClick={() => fetchJobs()} className="ml-auto flex items-center text-sm text-slate-500 hover:text-slate-900">
          <RefreshCw className="h-4 w-4 mr-1" /> Refresh
        </button>
      </div>

      <div className="flex gap-6 items-start h-[calc(100vh-220px)]">
        {/* Table View */}
        <div className={`overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-900/5 flex flex-col h-full ${selectedJob ? 'w-2/3' : 'w-full'}`}>
          <div className="overflow-x-auto flex-1">
            <table className="min-w-full divide-y divide-slate-300">
              <thead className="bg-slate-50 sticky top-0">
                <tr>
                  <th scope="col" className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-slate-900 sm:pl-6">ID</th>
                  <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-slate-900">Type</th>
                  <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-slate-900">Status</th>
                  <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-slate-900">Attempts</th>
                  <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-slate-900">Run At</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {jobs.map((job) => (
                  <tr 
                    key={job.id} 
                    onClick={() => loadJobDetail(job.id)}
                    className={cn(
                      'cursor-pointer hover:bg-slate-50',
                      selectedJob?.id === job.id && 'bg-blue-50 hover:bg-blue-50'
                    )}
                  >
                    <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-slate-900 sm:pl-6 truncate max-w-[120px]">
                      {job.id}
                    </td>
                    <td className="whitespace-nowrap px-3 py-4 text-sm text-slate-500">{job.type}</td>
                    <td className="whitespace-nowrap px-3 py-4 text-sm">
                      <span className={cn('inline-flex items-center rounded-full px-2 py-1 text-xs font-medium', statusColors[job.status] || 'bg-slate-100 text-slate-700')}>
                        {job.status}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-4 text-sm text-slate-500">{job.attemptCount}</td>
                    <td className="whitespace-nowrap px-3 py-4 text-sm text-slate-500">
                      {job.runAt ? format(new Date(job.runAt), 'MMM d, HH:mm:ss') : '-'}
                    </td>
                  </tr>
                ))}
                {!loading && jobs.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-sm text-slate-500">No jobs found</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {/* Pagination */}
          {meta && (
            <div className="border-t border-slate-200 bg-slate-50 px-6 py-3 flex items-center justify-between">
              <span className="text-sm text-slate-500">
                Page {meta.page} of {Math.ceil(meta.total / meta.limit) || 1} ({meta.total} jobs)
              </span>
              <div className="flex gap-2">
                <button 
                  disabled={page <= 1}
                  onClick={() => setPage(p => p - 1)}
                  className="rounded bg-white px-2 py-1 text-sm font-semibold text-slate-900 shadow-sm ring-1 ring-inset ring-slate-300 hover:bg-slate-50 disabled:opacity-50"
                >
                  Previous
                </button>
                <button 
                  disabled={page * meta.limit >= meta.total}
                  onClick={() => setPage(p => p + 1)}
                  className="rounded bg-white px-2 py-1 text-sm font-semibold text-slate-900 shadow-sm ring-1 ring-inset ring-slate-300 hover:bg-slate-50 disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Detail Panel */}
        {selectedJob && (
          <div className="w-1/3 overflow-y-auto rounded-xl bg-white shadow-sm ring-1 ring-slate-900/5 h-full p-6">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold leading-6 text-slate-900 truncate">Job Details</h3>
              <button onClick={() => setSelectedJob(null)} className="text-slate-400 hover:text-slate-500">
                <XCircle className="h-6 w-6" />
              </button>
            </div>
            
            <dl className="divide-y divide-slate-100">
              <div className="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-0">
                <dt className="text-sm font-medium leading-6 text-slate-900">ID</dt>
                <dd className="mt-1 text-sm leading-6 text-slate-700 sm:col-span-2 sm:mt-0 break-all">{selectedJob.id}</dd>
              </div>
              <div className="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-0">
                <dt className="text-sm font-medium leading-6 text-slate-900">Type</dt>
                <dd className="mt-1 text-sm leading-6 text-slate-700 sm:col-span-2 sm:mt-0 font-mono">{selectedJob.type}</dd>
              </div>
              <div className="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-0">
                <dt className="text-sm font-medium leading-6 text-slate-900">Payload</dt>
                <dd className="mt-1 text-xs leading-6 text-slate-700 sm:col-span-2 sm:mt-0">
                  <pre className="bg-slate-50 p-2 rounded overflow-x-auto">
                    {selectedJob.payload}
                  </pre>
                </dd>
              </div>
            </dl>

            {['FAILED', 'DEAD_LETTER'].includes(selectedJob.status) && (
              <div className="mt-6 border-t border-slate-100 pt-6">
                <button
                  onClick={() => handleRetry(selectedJob.id)}
                  className="w-full inline-flex justify-center items-center rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-500"
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Retry Job
                </button>
              </div>
            )}

            {selectedJob.deadLetter && selectedJob.deadLetter.length > 0 && (
              <div className="mt-6 border-t border-slate-100 pt-6">
                <h4 className="text-sm font-medium text-red-600 flex items-center mb-3">
                  <AlertCircle className="h-4 w-4 mr-2" />
                  Dead Letter Reason
                </h4>
                <div className="bg-red-50 p-3 rounded-md text-sm text-red-800 break-words">
                  {selectedJob.deadLetter[0].reason}
                </div>
              </div>
            )}

            {selectedJob.executions && selectedJob.executions.length > 0 && (
              <div className="mt-6 border-t border-slate-100 pt-6">
                <h4 className="text-sm font-medium text-slate-900 mb-3">Executions</h4>
                <ul className="space-y-3">
                  {selectedJob.executions.map((exec: any) => (
                    <li key={exec.id} className="bg-slate-50 p-3 rounded-md border border-slate-200">
                      <div className="flex justify-between items-center mb-2">
                        <span className={cn(
                          'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                          exec.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                        )}>
                          {exec.status}
                        </span>
                        <span className="text-xs text-slate-500 font-mono">Worker: {exec.workerId.substring(0,8)}</span>
                      </div>
                      <div className="text-xs text-slate-600 space-y-1">
                        <div>Start: {format(new Date(exec.startedAt), 'MMM d, HH:mm:ss')}</div>
                        {exec.finishedAt && <div>End: {format(new Date(exec.finishedAt), 'MMM d, HH:mm:ss')}</div>}
                        {exec.error && <div className="text-red-600 mt-1">Err: {exec.error}</div>}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
