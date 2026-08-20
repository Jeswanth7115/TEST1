/**
 * job-logger.ts
 * 
 * Writes a JobLog entry at each state transition.
 * Every claim, start, completion, failure, retry, and dead-letter event
 * is recorded for full auditability.
 */
import prisma from './db';



type LogLevel = 'INFO' | 'WARN' | 'ERROR';

export async function logJobEvent(
  jobId: string,
  level: LogLevel,
  message: string,
  executionId?: string
): Promise<void> {
  try {
    await prisma.jobLog.create({
      data: {
        jobId,
        executionId: executionId ?? null,
        level,
        message
      }
    });
  } catch (err) {
    // Logging should never crash the worker — swallow and stderr instead
    console.error(`[LOG-WRITE-FAIL] jobId=${jobId}: ${message}`, err);
  }
}
