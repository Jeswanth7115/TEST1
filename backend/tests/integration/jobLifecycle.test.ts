import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import prisma from '../../src/prisma';
import { runJob } from '../../src/worker/executor';
import * as handlerModule from '../../src/worker/handler';

describe('Job Lifecycle Integration', () => {
  let queueId: string;

  beforeEach(async () => {
    const org = await prisma.organization.create({ data: { name: 'Test Org' } });
    const project = await prisma.project.create({ data: { name: 'Test Project', orgId: org.id } });
    const queue = await prisma.queue.create({
      data: {
        name: 'Lifecycle Queue',
        projectId: project.id,
        concurrencyLimit: 5
      }
    });
    queueId = queue.id;

    await prisma.worker.create({
      data: { id: 'worker-1', hostname: 'test-host', status: 'ACTIVE', lastSeenAt: new Date() }
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('transitions to DEAD_LETTER after maxAttempts are exhausted', async () => {
    // Mock the handler to always fail
    vi.spyOn(handlerModule, 'executeJob').mockResolvedValue({
      success: false,
      error: 'Simulated permanent failure'
    });

    // Create a job with maxAttempts = 3
    let job = await prisma.job.create({
      data: {
        queueId,
        type: 'failing-job',
        payload: '{}',
        status: 'CLAIMED',
        priority: 0,
        maxAttempts: 3,
        attemptCount: 0
      }
    });

    // Attempt 1
    await runJob(job as any, 'worker-1');
    job = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(job.status).toBe('QUEUED');
    expect(job.attemptCount).toBe(1);

    // Attempt 2
    job = await prisma.job.update({ where: { id: job.id }, data: { status: 'CLAIMED' } });
    await runJob(job as any, 'worker-1');
    job = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(job.status).toBe('QUEUED');
    expect(job.attemptCount).toBe(2);

    // Attempt 3 (final)
    job = await prisma.job.update({ where: { id: job.id }, data: { status: 'CLAIMED' } });
    await runJob(job as any, 'worker-1');
    job = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    
    // Should now be DEAD_LETTER
    expect(job.status).toBe('DEAD_LETTER');
    expect(job.attemptCount).toBe(3);

    // Verify DeadLetterEntry was created
    const deadLetter = await prisma.deadLetterEntry.findUnique({
      where: { jobId: job.id }
    });
    expect(deadLetter).not.toBeNull();
    expect(deadLetter?.reason).toBe('Simulated permanent failure');
  });
});
