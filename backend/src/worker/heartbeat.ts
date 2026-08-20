/**
 * heartbeat.ts
 * 
 * Manages worker registration and the heartbeat loop.
 * 
 * On startup:
 *   - Inserts a Worker row with status='ACTIVE'
 * 
 * Every 5 seconds:
 *   - Creates a WorkerHeartbeat row
 *   - Updates Worker.lastSeenAt to now()
 * 
 * This allows the system to detect dead workers (no heartbeat in N seconds)
 * and reclaim their jobs.
 */
import prisma from './db';
import os from 'os';



let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Register this worker process in the database.
 * Returns the worker ID for use throughout the process lifecycle.
 */
export async function registerWorker(): Promise<string> {
  const worker = await prisma.worker.create({
    data: {
      hostname: `${os.hostname()}-${process.pid}`,
      status: 'ACTIVE',
      lastSeenAt: new Date()
    }
  });

  console.log(`[WORKER] Registered as ${worker.id} (${worker.hostname})`);
  return worker.id;
}

/**
 * Start the heartbeat loop. Runs every 5 seconds.
 */
export function startHeartbeat(workerId: string, getActiveJobCount: () => number): void {
  heartbeatInterval = setInterval(async () => {
    try {
      const activeJobCount = getActiveJobCount();
      await prisma.$transaction([
        prisma.workerHeartbeat.create({
          data: { workerId, activeJobCount }
        }),
        prisma.worker.update({
          where: { id: workerId },
          data: { lastSeenAt: new Date() }
        })
      ]);
    } catch (err) {
      console.error('[HEARTBEAT] Failed to send heartbeat:', err);
    }
  }, 5000);
}

/**
 * Stop the heartbeat loop.
 */
export function stopHeartbeat(): void {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

/**
 * Mark the worker as shutting down, then dead.
 */
export async function markWorkerShuttingDown(workerId: string): Promise<void> {
  await prisma.worker.update({
    where: { id: workerId },
    data: { status: 'SHUTTING_DOWN' }
  });
}

export async function markWorkerDead(workerId: string): Promise<void> {
  await prisma.worker.update({
    where: { id: workerId },
    data: { status: 'DEAD' }
  });
}

/**
 * Reaper: Detect workers that haven't sent a heartbeat recently.
 * Mark them as DEAD and transition their orphaned jobs back to QUEUED.
 */
export async function reapStaleWorkers(): Promise<void> {
  const STALE_TIMEOUT_MS = process.env.STALE_TIMEOUT_MS ? parseInt(process.env.STALE_TIMEOUT_MS, 10) : 15000; // 15 seconds
  const staleThreshold = new Date(Date.now() - STALE_TIMEOUT_MS);

  try {
    const staleWorkers = await prisma.worker.findMany({
      where: {
        status: 'ACTIVE',
        lastSeenAt: { lt: staleThreshold }
      }
    });

    for (const worker of staleWorkers) {
      console.warn(`[REAPER] Worker ${worker.id} is stale. Reclaiming orphaned jobs...`);

      await prisma.$transaction(async (tx) => {
        // Mark worker as DEAD
        await tx.worker.update({
          where: { id: worker.id },
          data: { status: 'DEAD' }
        });

        // Find active executions for this worker
        const activeExecutions = await tx.jobExecution.findMany({
          where: { workerId: worker.id, status: 'RUNNING' }
        });

        if (activeExecutions.length > 0) {
          const executionIds = activeExecutions.map(e => e.id);
          const jobIds = activeExecutions.map(e => e.jobId);

          // Mark executions as FAILED (worker died)
          await tx.jobExecution.updateMany({
            where: { id: { in: executionIds } },
            data: { status: 'FAILED', error: 'Worker died unexpectedly', finishedAt: new Date() }
          });

          // Reset jobs to QUEUED so they can be re-claimed.
          await tx.job.updateMany({
            where: { id: { in: jobIds } },
            data: { status: 'QUEUED' }
          });

          console.warn(`[REAPER] Reclaimed ${jobIds.length} jobs from dead worker ${worker.id}.`);
        }
      });
    }
  } catch (err) {
    console.error('[REAPER] Error reaping stale workers:', err);
  }
}
