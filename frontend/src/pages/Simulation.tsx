import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Clock3, KanbanSquare, LoaderCircle, Play, Plus, RefreshCw, RotateCcw, Send, ServerCog, XCircle } from 'lucide-react';
import { orgService, projectService, queueService, jobService, workerService } from '../api/services';

interface Project { id: string; name: string }
interface Queue { id: string; name: string; isPaused: boolean; concurrencyLimit: number }
interface Job { id: string; type: string; status: string; payload: string; createdAt: string; runAt?: string | null; attemptCount: number; maxAttempts: number; executions?: { worker?: { hostname: string }; status: string }[] }
interface DispatchJob { id: number; type: string; payload: string }
interface Worker { id: string; hostname: string; status: string; activeJobCount: number; lastSeenAt: string }

type Mode = 'immediate' | 'delayed' | 'scheduled' | 'batch';

const columns = [
  { key: 'QUEUED', label: 'Queued', hint: 'Waiting for an available worker', color: 'border-sky-200 bg-sky-50/60', icon: Clock3 },
  { key: 'CLAIMED', label: 'Claimed', hint: 'Reserved by a worker', color: 'border-indigo-200 bg-indigo-50/60', icon: ServerCog },
  { key: 'RUNNING', label: 'Running', hint: 'Currently executing', color: 'border-emerald-200 bg-emerald-50/60', icon: Play },
  { key: 'COMPLETED', label: 'Completed', hint: 'Successfully processed', color: 'border-slate-200 bg-slate-50/80', icon: CheckCircle2 },
  { key: 'FAILED', label: 'Failed', hint: 'Eligible for retry', color: 'border-rose-200 bg-rose-50/60', icon: XCircle },
  { key: 'DEAD_LETTER', label: 'Dead letter', hint: 'Retries exhausted', color: 'border-red-200 bg-red-50/60', icon: AlertCircle },
];

function getErrorMessage(error: any, fallback: string) {
  return error?.response?.data?.error?.message || fallback;
}

function zonedTimeToUtc(value: string, timezone: string): string {
  const [datePart, timePart] = value.split('T');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute] = timePart.split(':').map(Number);
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(guess);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const displayed = Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), Number(values.hour) % 24, Number(values.minute));
  const target = Date.UTC(year, month - 1, day, hour, minute);
  return new Date(guess.getTime() + target - displayed).toISOString();
}

export default function Simulation() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [queues, setQueues] = useState<Queue[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [selectedQueueId, setSelectedQueueId] = useState('');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [mode, setMode] = useState<Mode>('immediate');
  const [type, setType] = useState('fast-success');
  const [payload, setPayload] = useState('{\n  "source": "simulation"\n}');
  const [delayMs, setDelayMs] = useState('5000');
  const [runAt, setRunAt] = useState(() => new Date(Date.now() + 60000).toISOString().slice(0, 16));
  const [timezone, setTimezone] = useState(() => localStorage.getItem('timezone') || Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [dispatchJobs, setDispatchJobs] = useState<DispatchJob[]>([{ id: 1, type: 'fast-success', payload: '{\n  "sequence": 1\n}' }]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [ticketingJobId, setTicketingJobId] = useState('');

  const loadWorkspace = async () => {
    const orgResponse = await orgService.list();
    const orgId = orgResponse.data?.[0]?.id;
    if (!orgId) return;
    const projectResponse = await projectService.list(orgId);
    const nextProjects = projectResponse.data as Project[];
    setProjects(nextProjects);
    const projectId = selectedProjectId || nextProjects[0]?.id || '';
    setSelectedProjectId(projectId);
    if (!projectId) return;
    const queueResponse = await queueService.list(projectId);
    const nextQueues = queueResponse.data as Queue[];
    setQueues(nextQueues);
    const queueId = nextQueues.some((queue) => queue.id === selectedQueueId) ? selectedQueueId : nextQueues[0]?.id || '';
    setSelectedQueueId(queueId);
    if (queueId) await loadJobs(queueId);
  };

  const loadJobs = async (queueId = selectedQueueId) => {
    if (!queueId) return;
    const response = await jobService.list(queueId, { page: 1, limit: 100 });
    setJobs(response.data as Job[]);
    const workerResponse = await workerService.list();
    setWorkers(workerResponse.data as Worker[]);
  };

  useEffect(() => {
    loadWorkspace().catch((err) => setError(getErrorMessage(err, 'Unable to load simulation workspace.'))).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedQueueId) return;
    const timer = setInterval(() => loadJobs().catch(() => undefined), 2000);
    return () => clearInterval(timer);
  }, [selectedQueueId]);

  const groupedJobs = useMemo(() => {
    return columns.reduce<Record<string, Job[]>>((groups, column) => {
      groups[column.key] = jobs.filter((job) => job.status === column.key).slice(0, 12);
      return groups;
    }, {});
  }, [jobs]);

  const handleProjectChange = async (projectId: string) => {
    setSelectedProjectId(projectId);
    setSelectedQueueId('');
    try {
      const response = await queueService.list(projectId);
      const nextQueues = response.data as Queue[];
      setQueues(nextQueues);
      if (nextQueues[0]) {
        setSelectedQueueId(nextQueues[0].id);
        await loadJobs(nextQueues[0].id);
      } else setJobs([]);
    } catch (err) { setError(getErrorMessage(err, 'Unable to load project queues.')); }
  };

  const handleQueueChange = async (queueId: string) => {
    setSelectedQueueId(queueId);
    await loadJobs(queueId);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    setError('');
    try { await loadWorkspace(); } catch (err) { setError(getErrorMessage(err, 'Refresh failed.')); }
    finally { setRefreshing(false); }
  };

  const handleCreateJob = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedQueueId) { setError('Select a queue before assigning a job.'); return; }
    let parsedPayload: unknown;
    try { parsedPayload = JSON.parse(payload); } catch { setError('Payload must be valid JSON.'); return; }
    setSubmitting(true); setError(''); setMessage('');
    try {
      const data: Parameters<typeof jobService.create>[1] = { type, payload: parsedPayload, mode, demoMode: true };
      if (mode === 'delayed') data.delayMs = Number(delayMs);
      if (mode === 'scheduled') data.runAt = zonedTimeToUtc(runAt, timezone);
      data.demoMode = true;
      if (mode === 'batch') {
        const batchJobs = dispatchJobs.map((dispatchJob) => {
          let batchPayload: unknown;
          try { batchPayload = JSON.parse(dispatchJob.payload); } catch { throw new Error(`Payload for ${dispatchJob.type || 'job'} must be valid JSON.`); }
          return { type: dispatchJob.type, payload: batchPayload, demoMode: true };
        });
        data.jobs = batchJobs;
      }
      await jobService.create(selectedQueueId, data);
      setMessage(mode === 'immediate' ? 'Job assigned. The scheduler will claim it when a worker slot is available.' : `Job accepted as ${mode}. The scheduler will process it according to its timing policy.`);
      await loadJobs();
    } catch (err) { setError(getErrorMessage(err, 'The scheduler could not accept this job.')); }
    finally { setSubmitting(false); }
  };

  const raiseTicket = async (jobId: string) => {
    setTicketingJobId(jobId);
    try {
      await jobService.createTicket(jobId, 'Hanging simulation job requires administrator review.');
      setMessage('Support ticket raised. An administrator can remove this job from the Workers console.');
    } catch (err) { setError(getErrorMessage(err, 'Unable to raise support ticket.')); }
    finally { setTicketingJobId(''); }
  };

  if (loading) return <div className="flex min-h-[60vh] items-center justify-center text-sm text-slate-500"><LoaderCircle className="mr-2 h-5 w-5 animate-spin" />Loading simulation workspace...</div>;

  const selectedQueue = queues.find((queue) => queue.id === selectedQueueId);
  const updateDispatchJob = (id: number, field: 'type' | 'payload', value: string) => setDispatchJobs((current) => current.map((job) => job.id === id ? { ...job, [field]: value } : job));
  const addDispatchJob = () => setDispatchJobs((current) => [...current, { id: Date.now(), type: 'fast-success', payload: '{\n  "sequence": ' + (current.length + 1) + '\n}' }]);
  const removeDispatchJob = (id: number) => setDispatchJobs((current) => current.length > 1 ? current.filter((job) => job.id !== id) : current);

  return (
    <div className="space-y-7">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-sky-700"><KanbanSquare className="h-4 w-4" />Scheduler simulation</div>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Pipeline control board</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">Assign test work to a queue and watch the scheduler move each job through the execution pipeline in real time.</p>
        </div>
        <button type="button" onClick={handleRefresh} disabled={refreshing} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-60"><RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />Refresh board</button>
      </div>

      {message && <div role="status" className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800"><CheckCircle2 className="h-5 w-5" />{message}</div>}
      {error && <div role="alert" className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800"><AlertCircle className="h-5 w-5" />{error}</div>}

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-[#172b3b] p-4 text-white shadow-[0_14px_35px_rgba(23,43,59,0.12)]">
        <div className="mb-3 flex items-center justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#e6b86a]">Pipeline run</p><p className="mt-1 text-sm font-semibold">{selectedQueue ? selectedQueue.name : 'No queue selected'}</p></div><span className="rounded-full border border-white/15 px-3 py-1 text-[11px] font-semibold text-slate-300">Live · 2s refresh</span></div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">{columns.map((column, index) => { const Icon = column.icon; const count = jobs.filter((job) => job.status === column.key).length; return <div key={column.key} className="relative rounded-xl bg-white/[0.07] px-3 py-3">{index < columns.length - 1 && <span className="absolute right-[-9px] top-1/2 z-10 hidden h-px w-4 bg-[#e6b86a]/60 sm:block" />}<Icon className="h-4 w-4 text-[#e6b86a]" /><p className="mt-3 text-lg font-bold">{count}</p><p className="truncate text-[10px] font-semibold uppercase tracking-wide text-slate-400">{column.label}</p></div>; })}</div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm"><div className="flex items-center gap-2 text-sm font-bold text-slate-800"><ServerCog className="h-4 w-4 text-sky-700" />Connected workers <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">{workers.filter((worker) => worker.status === 'ACTIVE').length} active</span></div><div className="flex flex-wrap gap-2">{workers.filter((worker) => worker.status === 'ACTIVE').slice(0, 4).map((worker) => <span key={worker.id} className="rounded-lg bg-slate-50 px-2.5 py-1.5 font-mono text-[10px] text-slate-600">{worker.hostname} · {worker.activeJobCount} active</span>)}{!workers.length && <span className="text-xs text-amber-700">No workers connected. Jobs will remain queued.</span>}</div></div>

      <div className="grid gap-6 xl:grid-cols-[320px_1fr]">
        <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3 border-b border-slate-100 pb-5"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#e6b86a]/20 text-[#9a681d]"><Send className="h-4 w-4" /></span><div><h2 className="font-bold text-slate-950">Assign a job</h2><p className="text-xs text-slate-500">Select its destination queue</p></div></div>
          <form onSubmit={handleCreateJob} className="mt-5 space-y-4">
            <label className="block text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Project<select value={selectedProjectId} onChange={(event) => handleProjectChange(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-medium normal-case tracking-normal text-slate-800 outline-none focus:border-sky-500">{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
            <label className="block text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Queue<select value={selectedQueueId} onChange={(event) => handleQueueChange(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-medium normal-case tracking-normal text-slate-800 outline-none focus:border-sky-500"><option value="">Select a queue</option>{queues.map((queue) => <option key={queue.id} value={queue.id}>{queue.name}{queue.isPaused ? ' (paused)' : ''}</option>)}</select></label>
            {selectedQueue && <div className="rounded-xl bg-slate-50 px-3 py-3 text-xs text-slate-600">Capacity <strong className="text-slate-900">{selectedQueue.concurrencyLimit} concurrent jobs</strong>{selectedQueue.isPaused && <span className="mt-1 block font-semibold text-amber-700">This queue is paused. Jobs will remain queued.</span>}</div>}
            <label className="block text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Job type<select value={type} onChange={(event) => setType(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-medium normal-case tracking-normal text-slate-800 outline-none focus:border-sky-500"><option value="fast-success">Fast success</option><option value="slow-success">Slow success</option><option value="always-fail">Always fail</option><option value="sync-error">Synchronous error</option><option value="async-reject">Async rejection</option><option value="hang-forever">Hanging job / ticket</option></select></label>
            <label className="block text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Execution mode<select value={mode} onChange={(event) => setMode(event.target.value as Mode)} className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-medium normal-case tracking-normal text-slate-800 outline-none focus:border-sky-500"><option value="immediate">Immediate</option><option value="delayed">Delayed</option><option value="scheduled">Scheduled</option><option value="recurring">Recurring</option><option value="batch">Batch</option></select></label>
            {mode === 'delayed' && <label className="block text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Delay in milliseconds<input type="number" min="1" value={delayMs} onChange={(event) => setDelayMs(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm normal-case tracking-normal text-slate-800" /></label>}
            {mode === 'scheduled' && <label className="block text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Run at<input type="datetime-local" value={runAt} onChange={(event) => setRunAt(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm normal-case tracking-normal text-slate-800" /></label>}
            {mode === 'scheduled' && <label className="block text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Processing timezone<select value={timezone} onChange={(event) => { setTimezone(event.target.value); localStorage.setItem('timezone', event.target.value); }} className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-medium normal-case tracking-normal text-slate-800"><option value="UTC">UTC</option><option value="America/New_York">New York</option><option value="Europe/London">London</option><option value="Asia/Kolkata">Mumbai</option><option value="Asia/Tokyo">Tokyo</option><option value="Australia/Sydney">Sydney</option></select></label>}
            {mode === 'batch' && <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3"><div className="flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Job manifest</p><p className="mt-1 text-[11px] text-slate-500">Dispatch several jobs together</p></div><button type="button" onClick={addDispatchJob} className="inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1.5 text-xs font-bold text-sky-700 shadow-sm ring-1 ring-slate-200"><Plus className="h-3 w-3" />Add job</button></div>{dispatchJobs.map((dispatchJob, index) => <div key={dispatchJob.id} className="rounded-lg border border-slate-200 bg-white p-2.5"><div className="mb-2 flex items-center justify-between"><span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Job {index + 1}</span><button type="button" onClick={() => removeDispatchJob(dispatchJob.id)} className="text-[10px] font-semibold text-slate-400 hover:text-rose-600">Remove</button></div><input value={dispatchJob.type} onChange={(event) => updateDispatchJob(dispatchJob.id, 'type', event.target.value)} className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-xs font-semibold text-slate-800" placeholder="job type" /><textarea value={dispatchJob.payload} onChange={(event) => updateDispatchJob(dispatchJob.id, 'payload', event.target.value)} rows={3} className="mt-2 w-full rounded-lg border border-slate-200 px-2.5 py-2 font-mono text-[11px] text-slate-700" /></div>)}</div>}
            {mode !== 'batch' && <label className="block text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Payload<textarea value={payload} onChange={(event) => setPayload(event.target.value)} rows={5} className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5 font-mono text-xs normal-case tracking-normal text-slate-800 outline-none focus:border-sky-500" /></label>}
            <button type="submit" disabled={submitting || !selectedQueueId} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#1f6f9f] px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-[#195c85] disabled:cursor-not-allowed disabled:opacity-50"><Plus className="h-4 w-4" />{submitting ? 'Submitting...' : 'Assign to scheduler'}</button>
          </form>
        </section>

        <section className="min-w-0">
          <div className="mb-4 flex items-center justify-between"><div><h2 className="font-bold text-slate-950">Execution pipeline</h2><p className="mt-1 text-xs text-slate-500">{selectedQueue ? `Live view for ${selectedQueue.name}` : 'Select a queue to view its pipeline'}</p></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">{jobs.length} jobs tracked</span></div>
          <div className="grid gap-3 overflow-x-auto pb-3 md:grid-cols-2 2xl:grid-cols-3">
            {columns.map((column) => { const Icon = column.icon; return <div key={column.key} className={`min-h-[260px] min-w-[240px] rounded-2xl border p-3 ${column.color}`}><div className="flex items-start justify-between gap-2 px-2 pb-3"><div><div className="flex items-center gap-2 text-sm font-bold text-slate-900"><Icon className="h-4 w-4" />{column.label}<span className="rounded-full bg-white/80 px-2 py-0.5 text-[11px]">{groupedJobs[column.key]?.length || 0}</span></div><p className="mt-1 text-[11px] text-slate-500">{column.hint}</p></div></div><div className="space-y-2">{groupedJobs[column.key]?.map((job) => <article key={job.id} className="rounded-xl border border-white/80 bg-white p-3 shadow-sm"><div className="flex items-center justify-between gap-2"><span className="truncate text-xs font-bold text-slate-800">{job.type}</span><span className="text-[10px] font-semibold text-slate-400">#{job.id.slice(0, 6)}</span></div><p className="mt-2 text-[11px] text-slate-500">Attempt {job.attemptCount} / {job.maxAttempts}</p>{job.executions?.[0]?.worker && <p className="mt-1 truncate font-mono text-[10px] text-sky-700">Worker: {job.executions[0].worker.hostname}</p>}{job.runAt && job.status !== 'COMPLETED' && <p className="mt-1 text-[10px] text-slate-400">Run at {new Date(job.runAt).toLocaleTimeString()}</p>}{job.type === 'hang-forever' && <button type="button" onClick={() => raiseTicket(job.id)} disabled={ticketingJobId === job.id} className="mt-2 inline-flex items-center gap-1 rounded-lg border border-rose-200 px-2 py-1 text-[10px] font-bold text-rose-700 hover:bg-rose-50">{ticketingJobId === job.id ? 'Raising...' : 'Raise admin ticket'}</button>}</article>)}</div>{!groupedJobs[column.key]?.length && <p className="px-2 pt-6 text-center text-xs text-slate-400">No jobs in this stage</p>}</div>; })}
          </div>
          <div className="mt-4 flex items-start gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs leading-5 text-slate-600"><RotateCcw className="mt-0.5 h-4 w-4 shrink-0 text-sky-700" /><span><strong className="text-slate-900">Scheduler behavior:</strong> queued jobs remain visible until a worker claims them. Paused queues intentionally hold jobs; failed jobs are retried according to their queue policy and move to dead letter after the retry limit.</span></div>
        </section>
      </div>
    </div>
  );
}
