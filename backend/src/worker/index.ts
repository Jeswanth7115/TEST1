/**
 * Worker Process — Main Entry Point
 * 
 * Run with: npm run worker:start
 * 
 * This is a standalone process that:
 *   1. Registers itself as a Worker in the DB
 *   2. Starts a heartbeat loop (every 5s)
 *   3. Starts a polling loop (every 2s) to claim and execute jobs
 *   4. Starts a scheduler loop (every 10s) for recurring jobs
 *   5. Handles SIGTERM/SIGINT for graceful shutdown
 * 
 * Multiple instances of this process can run concurrently.
 * The atomic claim logic in poller.ts ensures no two workers
 * ever claim the same job.
 */
import { registerWorker, startHeartbeat, stopHeartbeat, markWorkerShuttingDown, markWorkerDead, reapStaleWorkers } from './heartbeat';
import { pollAndClaim } from './poller';
import { runJob } from './executor';
import { startScheduler, stopScheduler } from './scheduler';

// ─── State ───
let workerId: string;
let isShuttingDown = false;
let pollInterval: ReturnType<typeof setInterval> | null = null;

// Track in-flight jobs for graceful shutdown
const inFlightJobs = new Set<Promise<void>>();

/**
 * Returns the number of currently executing jobs.
 * Used by the heartbeat to report active job count.
 */
function getActiveJobCount(): number {
  return inFlightJobs.size;
}

/**
 * Main polling cycle. Called every 2 seconds.
 * 
 * IMPORTANT (SQLite): Jobs are processed sequentially, not concurrently.
 * SQLite only supports a single writer at a time. If we fire many concurrent
 * transactions, they all compete for the write lock and timeout.
 * 
 * For PostgreSQL, you would switch to concurrent execution here since PG
 * supports row-level locking and concurrent writers.
 */
async function pollCycle(): Promise<void> {
  if (isShuttingDown) return;

  try {
    const claimed = await pollAndClaim(workerId);

    for (const job of claimed) {
      // We removed 'if (isShuttingDown) break;' because if we break here, 
      // the jobs we just atomically claimed are left stuck in CLAIMED status forever.
      // Since the batch is small (max 3), we just let them finish executing.

      // Sequential execution for SQLite compatibility.
      // Track as in-flight for graceful shutdown awareness.
      const jobPromise = runJob(job, workerId);
      inFlightJobs.add(jobPromise);
      await jobPromise;
      inFlightJobs.delete(jobPromise);
    }

    if (claimed.length > 0) {
      console.log(`[WORKER] Processed ${claimed.length} job(s).`);
    }

    // Run the reaper occasionally (every cycle is fine since it's cheap, but we can do it asynchronously)
    reapStaleWorkers().catch(err => console.error('[WORKER] Reaper error:', err));
  } catch (err) {
    console.error('[WORKER] Poll cycle error:', err);
  }
}

/**
 * Graceful Shutdown Handler
 * 
 * On SIGTERM or SIGINT:
 *   1. Stop claiming new jobs (set isShuttingDown flag)
 *   2. Stop the polling loop
 *   3. Stop the scheduler
 *   4. Mark the worker as SHUTTING_DOWN
 *   5. Wait for all in-flight jobs to finish (with a 30s timeout)
 *   6. Stop the heartbeat
 *   7. Mark the worker as DEAD
 *   8. Exit cleanly
 */
async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) return; // Prevent double-shutdown
  isShuttingDown = true;

  console.log(`\n[WORKER] Received ${signal}. Starting graceful shutdown...`);

  // Step 1: Stop polling for new jobs
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }

  // Step 2: Stop the scheduler
  stopScheduler();

  // Step 3: Mark worker as shutting down
  try {
    await markWorkerShuttingDown(workerId);
    console.log('[WORKER] Marked as SHUTTING_DOWN');
  } catch (err) {
    console.error('[WORKER] Failed to mark as SHUTTING_DOWN:', err);
  }

  // Step 4: Wait for in-flight jobs with a timeout
  if (inFlightJobs.size > 0) {
    console.log(`[WORKER] Waiting for ${inFlightJobs.size} in-flight job(s) to finish...`);

    const SHUTDOWN_TIMEOUT = 30000; // 30 seconds
    const timeoutPromise = new Promise<void>((resolve) => {
      setTimeout(() => {
        console.warn(`[WORKER] Shutdown timeout reached. ${inFlightJobs.size} job(s) still running.`);
        resolve();
      }, SHUTDOWN_TIMEOUT);
    });

    await Promise.race([
      Promise.allSettled([...inFlightJobs]),
      timeoutPromise
    ]);
  }

  // Step 5: Stop the heartbeat
  stopHeartbeat();

  // Step 6: Mark worker as dead
  try {
    await markWorkerDead(workerId);
    console.log('[WORKER] Marked as DEAD. Goodbye!');
  } catch (err) {
    console.error('[WORKER] Failed to mark as DEAD:', err);
  }

  process.exit(0);
}

/**
 * Main entry point.
 */
async function main(): Promise<void> {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║       Job Scheduler Worker v1.0          ║');
  console.log('╚══════════════════════════════════════════╝');

  // Register worker
  workerId = await registerWorker();

  // Start heartbeat (every 5s)
  startHeartbeat(workerId, getActiveJobCount);
  console.log('[WORKER] Heartbeat started (5s interval)');

  // Start recurring job scheduler (every 10s)
  startScheduler();

  // Start polling loop (every 2s)
  pollInterval = setInterval(pollCycle, 2000);
  // Also run immediately
  pollCycle();
  console.log('[WORKER] Polling started (2s interval)');
  console.log('[WORKER] Ready to process jobs!\n');

  // Register shutdown handlers
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

  // Cross-platform shutdown: closing the worker's stdin pipe from the parent
  // process triggers graceful shutdown. This is more reliable than SIGINT on
  // Windows (where spawned child processes don't receive Ctrl+C from Node).
  process.stdin.resume();
  process.stdin.on('close', () => gracefulShutdown('STDIN_CLOSE'));
}

main().catch((err) => {
  console.error('[WORKER] Fatal startup error:', err);
  process.exit(1);
});
