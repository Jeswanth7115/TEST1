/**
 * scheduler.ts — Recurring Job Scheduler
 * 
 * A lightweight loop that checks ScheduledJob rows where nextRunAt <= now.
 * For each due schedule:
 *   1. Creates a new Job instance (status=QUEUED, runAt=now)
 *   2. Advances nextRunAt using the cron expression
 * 
 * This runs independently of the main polling loop.
 */
import prisma from './db';
import { computeNextRunAt } from './cron';



let schedulerInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Check for due recurring schedules and spawn new job instances.
 */
async function checkSchedules(): Promise<void> {
  try {
    const dueSchedules = await prisma.scheduledJob.findMany({
      where: {
        isActive: true,
        nextRunAt: { lte: new Date() }
      },
      include: {
        job: true
      }
    });

    for (const schedule of dueSchedules) {
      try {
        const nextRunAt = computeNextRunAt(schedule.cronExpression);

        // Prevent overlapping runs: check if a job from this schedule is already active
        const activeInstance = await prisma.job.findFirst({
          where: {
            queueId: schedule.job.queueId,
            type: schedule.job.type,
            cronExpression: schedule.cronExpression,
            status: { in: ['QUEUED', 'CLAIMED', 'RUNNING'] }
          }
        });

        await prisma.$transaction(async (tx) => {
          if (!activeInstance) {
            // Create a new job instance based on the template job
            await tx.job.create({
              data: {
              queueId: schedule.job.queueId,
              type: schedule.job.type,
              payload: schedule.job.payload,
              status: 'QUEUED',
              priority: schedule.job.priority,
              runAt: new Date(),
              cronExpression: schedule.cronExpression,
              retryPolicyId: schedule.job.retryPolicyId
            }
          });
        } else {
          console.log(`[SCHEDULER] Skipping schedule ${schedule.id} to prevent overlap (active instance: ${activeInstance.id})`);
        }

        // Advance the schedule's nextRunAt
        await tx.scheduledJob.update({
            where: { id: schedule.id },
            data: { nextRunAt }
          });
        });

        console.log(`[SCHEDULER] Spawned job from schedule ${schedule.id}, next run: ${nextRunAt.toISOString()}`);
      } catch (err) {
        console.error(`[SCHEDULER] Error processing schedule ${schedule.id}:`, err);
      }
    }
  } catch (err) {
    console.error('[SCHEDULER] Error checking schedules:', err);
  }
}

/**
 * Start the recurring job scheduler loop (checks every 10s).
 */
export function startScheduler(): void {
  // Run immediately on start, then every 10 seconds
  checkSchedules();
  schedulerInterval = setInterval(checkSchedules, 10000);
  console.log('[SCHEDULER] Started recurring job scheduler (10s interval)');
}

/**
 * Stop the scheduler loop.
 */
export function stopScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}
