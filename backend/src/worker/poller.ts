/**
 * poller.ts — Atomic Job Claiming
 *
 * ╔═══════════════════════════════════════════════════════════════════════╗
 * ║                    ATOMIC CLAIM LOGIC (CRITICAL)                     ║
 * ╠═══════════════════════════════════════════════════════════════════════╣
 * ║                                                                       ║
 * ║  Goal: NO two workers may ever claim the same job simultaneously.    ║
 * ║                                                                       ║
 * ║  Because SQLite uses a database-level write lock, only ONE write     ║
 * ║  transaction can execute at a time. All other writers block (with    ║
 * ║  WAL mode) or get SQLITE_BUSY. This means our claim transaction is   ║
 * ║  inherently serialized.                                              ║
 * ║                                                                       ║
 * ║  1. BEGIN TRANSACTION                                                 ║
 * ║  2. SELECT eligible jobs (status='QUEUED')                            ║
 * ║  3. UPDATE those jobs (status='CLAIMED')                              ║
 * ║  4. COMMIT                                                            ║
 * ║                                                                       ║
 * ╚═══════════════════════════════════════════════════════════════════════╝
 */
import prisma from './db';

export interface ClaimedJob {
  id: string;
  queueId: string;
  type: string;
  payload: string;
  priority: number;
  attemptCount: number;
  maxAttempts: number;
  retryPolicyId: string | null;
  cronExpression: string | null;
  batchId: string | null;
  demoMode: boolean;
}

export async function pollAndClaim(workerId: string): Promise<ClaimedJob[]> {
  const allClaimed: ClaimedJob[] = [];

  const worker = await prisma.worker.findUnique({ where: { id: workerId }, select: { status: true } });
  if (!worker || worker.status !== 'ACTIVE') {
    console.warn(`[POLL] Worker ${workerId} is no longer active; skipping claims.`);
    return allClaimed;
  }

  // Each process claims only its available capacity. This prevents the first
  // polling node from taking an entire queue and lets live nodes share work.
  const workerCapacity = Math.max(1, Number(process.env.WORKER_CONCURRENCY || 1));
  const activeForWorker = await prisma.jobExecution.count({
    where: { workerId, status: 'RUNNING' }
  });
  let remainingCapacity = Math.max(0, workerCapacity - activeForWorker);
  if (remainingCapacity === 0) return allClaimed;

  const queues = await prisma.queue.findMany({ where: { isPaused: false } });

  for (const queue of queues) {
    try {
      const runningCount = await prisma.job.count({
        where: { queueId: queue.id, status: { in: ['CLAIMED', 'RUNNING'] } }
      });

      const availableSlots = Math.min(queue.concurrencyLimit - runningCount, remainingCapacity);
      if (availableSlots <= 0) continue;

      const claimed = await prisma.$transaction(async (tx) => {
        // Delayed and one-time scheduled jobs become claimable when due.
        // Recurring templates keep cronExpression set and are advanced by scheduler.ts.
        await tx.job.updateMany({
          where: {
            queueId: queue.id,
            status: 'SCHEDULED',
            cronExpression: null,
            runAt: { lte: new Date() }
          },
          data: { status: 'QUEUED' }
        });

        const eligible = await tx.job.findMany({
          where: {
            queueId: queue.id,
            status: 'QUEUED',
            runAt: { lte: new Date() },
          },
          orderBy: [{ priority: 'desc' }, { runAt: 'asc' }, { createdAt: 'asc' }],
          take: availableSlots,
        });

        if (eligible.length === 0) return [];

        const ids = eligible.map(j => j.id);

        await tx.job.updateMany({
          where: { id: { in: ids }, status: 'QUEUED' },
          data: { status: 'CLAIMED', claimedByWorkerId: workerId, claimedAt: new Date() },
        });

        return eligible;
      });

      allClaimed.push(...claimed.map(j => ({
        id: j.id,
        queueId: j.queueId,
        type: j.type,
        payload: j.payload,
        priority: j.priority,
        attemptCount: j.attemptCount,
        maxAttempts: j.maxAttempts,
        retryPolicyId: j.retryPolicyId,
        cronExpression: j.cronExpression,
        batchId: j.batchId,
        demoMode: j.demoMode,
      })));
      remainingCapacity -= claimed.length;
      if (remainingCapacity === 0) break;

    } catch (err) {
      console.error(`[POLL] Error polling queue ${queue.id}:`, (err as Error).message);
    }
  }

  return allClaimed;
}
