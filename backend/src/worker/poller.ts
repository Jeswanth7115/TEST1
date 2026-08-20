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
}

export async function pollAndClaim(workerId: string): Promise<ClaimedJob[]> {
  const allClaimed: ClaimedJob[] = [];

  const queues = await prisma.queue.findMany({ where: { isPaused: false } });

  for (const queue of queues) {
    try {
      const runningCount = await prisma.job.count({
        where: { queueId: queue.id, status: { in: ['CLAIMED', 'RUNNING'] } }
      });

      const availableSlots = Math.min(queue.concurrencyLimit - runningCount, 3);
      if (availableSlots <= 0) continue;

      const claimed = await prisma.$transaction(async (tx) => {
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
          data: { status: 'CLAIMED' },
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
      })));

    } catch (err) {
      console.error(`[POLL] Error polling queue ${queue.id}:`, (err as Error).message);
    }
  }

  return allClaimed;
}
