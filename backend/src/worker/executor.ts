/**
 * executor.ts — Job Execution + Retry Logic
 * 
 * For each claimed job:
 *   1. Set status → RUNNING, create a JobExecution row
 *   2. Call the pluggable handler
 *   3. On success: status → COMPLETED, fill in JobExecution
 *   4. On failure: apply RetryPolicy to decide whether to retry or dead-letter
 * 
 * Retry strategies:
 *   FIXED:       delay = baseDelayMs (constant)
 *   LINEAR:      delay = baseDelayMs * attemptCount
 *   EXPONENTIAL: delay = baseDelayMs * 2^(attemptCount-1), capped at maxDelayMs
 */
import prisma from './db';
import { executeJob } from './handler';
import { logJobEvent } from './job-logger';
import type { ClaimedJob } from './poller';



/**
 * Calculate the next retry delay based on the retry policy strategy.
 */
export function calculateRetryDelay(
  strategy: string,
  baseDelayMs: number,
  attemptCount: number,
  maxDelayMs: number | null
): number {
  let delay: number;

  switch (strategy) {
    case 'LINEAR':
      delay = baseDelayMs * attemptCount;
      break;
    case 'EXPONENTIAL':
      delay = baseDelayMs * Math.pow(2, attemptCount - 1);
      break;
    case 'FIXED':
    default:
      delay = baseDelayMs;
      break;
  }

  // Cap at maxDelayMs if specified
  if (maxDelayMs && delay > maxDelayMs) {
    delay = maxDelayMs;
  }

  return delay;
}

/**
 * Run a single claimed job through the full lifecycle:
 * CLAIMED → RUNNING → COMPLETED | FAILED/RETRY | DEAD_LETTER
 */
export async function runJob(job: ClaimedJob, workerId: string): Promise<void> {
  const startTime = Date.now();
  let executionId: string | undefined;

  try {
    // ─── STEP 1: Transition to RUNNING, create execution record ───
    const execution = await prisma.$transaction(async (tx) => {
      await tx.job.update({
        where: { id: job.id },
        data: { status: 'RUNNING' }
      });
      return tx.jobExecution.create({
        data: {
          jobId: job.id,
          workerId,
          status: 'RUNNING'
        }
      });
    });

    executionId = execution.id;
    await logJobEvent(job.id, 'INFO', `Job started by worker ${workerId}`, executionId);

    // ─── STEP 2: Execute the pluggable handler with timeout ───
    const JOB_TIMEOUT_MS = process.env.JOB_TIMEOUT_MS ? parseInt(process.env.JOB_TIMEOUT_MS, 10) : 5 * 60 * 1000;
    let result: { success: boolean; error?: string };

    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`Job execution timed out after ${JOB_TIMEOUT_MS}ms`)), JOB_TIMEOUT_MS);
      });

      result = await Promise.race([
        executeJob({
          id: job.id,
          type: job.type,
          payload: job.payload,
          queueId: job.queueId
        }),
        timeoutPromise
      ]);
    } catch (execErr) {
      // Catch synchronous errors, rejected promises, and timeouts
      result = { success: false, error: String(execErr) };
    }

    const durationMs = Date.now() - startTime;

    if (result.success) {
      // ─── STEP 3a: SUCCESS → COMPLETED ───
      await prisma.$transaction(async (tx) => {
        const latestExec = await tx.jobExecution.findFirst({
          where: { jobId: job.id },
          orderBy: { startedAt: 'desc' }
        });
        if (latestExec?.id !== executionId) {
          throw new Error('Optimistic lock failed: Job execution was reassigned to another worker');
        }
        await tx.job.update({
          where: { id: job.id },
          data: { status: 'COMPLETED' }
        });
        await tx.jobExecution.update({
          where: { id: executionId },
          data: {
            status: 'COMPLETED',
            finishedAt: new Date(),
            durationMs
          }
        });
      });

      await logJobEvent(job.id, 'INFO', `Job completed in ${durationMs}ms`, executionId);
    } else {
      // ─── STEP 3b: FAILURE → Retry or Dead-Letter ───
      const newAttemptCount = job.attemptCount + 1;

      // Fetch retry policy first to calculate next delay
      let retryPolicy = null;
      if (job.retryPolicyId) {
        retryPolicy = await prisma.retryPolicy.findUnique({ where: { id: job.retryPolicyId } });
      }
      if (!retryPolicy) {
        const queue = await prisma.queue.findUnique({
          where: { id: job.queueId },
          include: { retryPolicy: true }
        });
        retryPolicy = queue?.retryPolicy ?? null;
      }

      const maxAttempts = retryPolicy ? retryPolicy.maxRetries : job.maxAttempts;
      const willRetry = newAttemptCount < maxAttempts;
      const nextDelayMs = retryPolicy
        ? calculateRetryDelay(retryPolicy.strategy, retryPolicy.baseDelayMs, newAttemptCount, retryPolicy.maxDelayMs)
        : 5000;

      await prisma.$transaction(async (tx) => {
        const latestExec = await tx.jobExecution.findFirst({
          where: { jobId: job.id },
          orderBy: { startedAt: 'desc' }
        });
        if (latestExec?.id !== executionId) {
          throw new Error('Optimistic lock failed: Job execution was reassigned to another worker');
        }

        // Record the failed execution
        await tx.jobExecution.update({
          where: { id: executionId },
          data: {
            status: 'FAILED',
            finishedAt: new Date(),
            durationMs,
            error: result.error || 'Unknown error'
          }
        });

        // Update the Job itself based on retry logic
        if (willRetry) {
          await tx.job.update({
            where: { id: job.id },
            data: {
              status: 'QUEUED',
              attemptCount: newAttemptCount,
              runAt: new Date(Date.now() + nextDelayMs)
            }
          });
        } else {
          await tx.job.update({
            where: { id: job.id },
            data: {
              status: 'DEAD_LETTER',
              attemptCount: newAttemptCount
            }
          });

          await tx.deadLetterEntry.create({
            data: {
              jobId: job.id,
              reason: `Max attempts (${maxAttempts}) reached. Last error: ${result.error}`,
              originalPayload: job.payload
            }
          });
        }
      });

      await logJobEvent(job.id, 'ERROR', `Job failed: ${result.error}`, executionId);
      if (willRetry) {
        await logJobEvent(job.id, 'WARN',
          `Retrying (attempt ${newAttemptCount + 1}/${maxAttempts}) in ${nextDelayMs}ms (strategy: ${retryPolicy?.strategy ?? 'FALLBACK'})`,
          executionId
        );
      } else {
        await logJobEvent(job.id, 'ERROR',
          `Job dead-lettered after ${newAttemptCount} attempts: ${result.error}`,
          executionId
        );
      }
    }
  } catch (err) {
    // Unexpected crash during execution — mark as failed
    console.error(`[EXECUTOR] Unexpected error for job ${job.id}:`, err);
    try {
      await prisma.job.update({
        where: { id: job.id },
        data: { status: 'FAILED', attemptCount: job.attemptCount + 1 }
      });
      if (executionId) {
        await prisma.jobExecution.update({
          where: { id: executionId },
          data: {
            status: 'FAILED',
            finishedAt: new Date(),
            durationMs: Date.now() - startTime,
            error: String(err)
          }
        });
      }
      await logJobEvent(job.id, 'ERROR', `Unexpected executor crash: ${err}`);
    } catch (innerErr) {
      console.error(`[EXECUTOR] Failed to record failure for job ${job.id}:`, innerErr);
    }
  }
}
