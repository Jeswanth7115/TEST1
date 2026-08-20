import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { queueService } from '../api/services';
import StatCard from '../components/StatCard';
import ThroughputChart from '../components/ThroughputChart';
import { Play, Pause, Settings, List, Activity } from 'lucide-react';

export default function QueueDetail() {
  const { queueId } = useParams();
  const [queue, setQueue] = useState<any>(null);
  const [metrics, setMetrics] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const fetchQueueData = async () => {
    if (!queueId) return;
    try {
      const qData = await queueService.get(queueId);
      setQueue(qData);
      const mData = await queueService.getMetrics(queueId);
      setMetrics(mData);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchQueueData();
    const interval = setInterval(fetchQueueData, 3000); // Live poll every 3s
    return () => clearInterval(interval);
  }, [queueId]);

  const togglePause = async () => {
    if (!queue) return;
    try {
      if (queue.isPaused) {
        await queueService.resume(queue.id);
      } else {
        await queueService.pause(queue.id);
      }
      fetchQueueData();
    } catch (err) {
      console.error(err);
    }
  };

  if (loading && !queue) return <div className="p-8">Loading...</div>;
  if (!queue) return <div className="p-8">Queue not found</div>;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold leading-7 text-slate-900 sm:truncate sm:text-3xl sm:tracking-tight">
            Queue: {queue.name}
          </h2>
          <p className="mt-1 flex items-center text-sm text-slate-500">
            Project ID: {queue.projectId}
          </p>
        </div>
        <div className="mt-4 flex sm:ml-4 sm:mt-0 gap-3">
          <Link
            to={`/queues/${queue.id}/jobs`}
            className="inline-flex items-center rounded-md bg-white px-3 py-2 text-sm font-semibold text-slate-900 shadow-sm ring-1 ring-inset ring-slate-300 hover:bg-slate-50"
          >
            <List className="h-4 w-4 mr-2 text-slate-400" />
            View Jobs
          </Link>
          <button
            onClick={togglePause}
            className={`inline-flex items-center rounded-md px-3 py-2 text-sm font-semibold text-white shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${
              queue.isPaused 
                ? 'bg-emerald-600 hover:bg-emerald-500 focus-visible:outline-emerald-600' 
                : 'bg-amber-600 hover:bg-amber-500 focus-visible:outline-amber-600'
            }`}
          >
            {queue.isPaused ? (
              <><Play className="h-4 w-4 mr-2" /> Resume</>
            ) : (
              <><Pause className="h-4 w-4 mr-2" /> Pause</>
            )}
          </button>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Queued" value={queue.stats?.QUEUED || 0} colorClass="text-blue-600" />
        <StatCard title="Running" value={queue.stats?.RUNNING || 0} colorClass="text-emerald-600" />
        <StatCard title="Completed" value={queue.stats?.COMPLETED || 0} />
        <StatCard title="Failed / DLQ" value={(queue.stats?.FAILED || 0) + (queue.stats?.DEAD_LETTER || 0)} colorClass="text-red-600" />
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        {/* Throughput Chart */}
        <div className="lg:col-span-2 overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-900/5">
          <div className="border-b border-slate-200 bg-slate-50 px-6 py-4">
            <h3 className="text-base font-semibold leading-6 text-slate-900 flex items-center">
              <Activity className="mr-2 h-5 w-5 text-slate-400" />
              Throughput (Last Hour)
            </h3>
          </div>
          <div className="p-6">
            <div className="mb-4 flex gap-8">
              <div>
                <p className="text-sm font-medium text-slate-500">Jobs / Min</p>
                <p className="text-2xl font-semibold text-slate-900">
                  {metrics?.throughputPerMinute?.toFixed(1) || '0.0'}
                </p>
              </div>
              <div>
                <p className="text-sm font-medium text-slate-500">Avg Duration</p>
                <p className="text-2xl font-semibold text-slate-900">
                  {metrics?.averageDurationMs ? `${Math.round(metrics.averageDurationMs)}ms` : '-'}
                </p>
              </div>
              <div>
                <p className="text-sm font-medium text-slate-500">Failure Rate</p>
                <p className="text-2xl font-semibold text-slate-900">
                  {metrics?.failureRate ? `${(metrics.failureRate * 100).toFixed(1)}%` : '0%'}
                </p>
              </div>
            </div>
            <ThroughputChart data={[]} />
          </div>
        </div>

        {/* Configuration Panel */}
        <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-900/5 h-fit">
          <div className="border-b border-slate-200 bg-slate-50 px-6 py-4">
            <h3 className="text-base font-semibold leading-6 text-slate-900 flex items-center">
              <Settings className="mr-2 h-5 w-5 text-slate-400" />
              Configuration
            </h3>
          </div>
          <div className="px-6 py-5">
            <dl className="space-y-4">
              <div>
                <dt className="text-sm font-medium text-slate-500">Concurrency Limit</dt>
                <dd className="mt-1 text-sm text-slate-900">{queue.concurrencyLimit} concurrent jobs</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-slate-500">Priority</dt>
                <dd className="mt-1 text-sm text-slate-900">Level {queue.priority}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-slate-500">Retry Policy</dt>
                <dd className="mt-1 text-sm text-slate-900">
                  {queue.retryPolicy ? (
                    <>
                      {queue.retryPolicy.strategy} ({queue.retryPolicy.maxRetries} max retries)<br/>
                      Base Delay: {queue.retryPolicy.baseDelayMs}ms
                    </>
                  ) : 'None'}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}
