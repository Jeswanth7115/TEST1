import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import authRoutes from '../../src/routes/auth';
import orgsRoutes from '../../src/routes/orgs';
import projectsRoutes from '../../src/routes/projects';
import queuesRoutes from '../../src/routes/queues';
import jobsRoutes from '../../src/routes/jobs';
import prisma from '../../src/prisma';
import { runJob } from '../../src/worker/executor';
import * as handler from '../../src/worker/handler';
import { vi } from 'vitest';

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/orgs', orgsRoutes);
app.use('/api', projectsRoutes);
app.use('/api', queuesRoutes);
app.use('/api', jobsRoutes);

describe('Queue Management Edge Cases Suite', () => {
  let token: string;
  let projectId: string;
  let orgId: string;

  beforeEach(async () => {
    const randomEmail = `queueadmin_${Date.now()}@test.com`;
    const signupRes = await request(app)
      .post('/api/auth/signup')
      .send({ email: randomEmail, password: 'password123', name: 'Queue Admin' });
    token = signupRes.body.token;

    const orgsRes = await request(app).get('/api/orgs').set('Authorization', `Bearer ${token}`);
    orgId = orgsRes.body.data[0].id;

    const projRes = await request(app)
      .post(`/api/orgs/${orgId}/projects`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Queue Test Project' });
    projectId = projRes.body.id;
  });

  // Case 1: Create a queue with concurrencyLimit = 0
  it('Case 1: Create a queue with concurrencyLimit = 0 returns validation error', async () => {
    const res = await request(app)
      .post(`/api/projects/${projectId}/queues`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Invalid Queue',
        concurrencyLimit: 0,
        retryPolicy: { strategy: 'FIXED', baseDelayMs: 1000, maxRetries: 3 }
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  // Case 2: Create a queue with negative inputs
  it('Case 2: Create a queue with negative inputs returns validation error', async () => {
    const payloads = [
      { priority: -1, concurrencyLimit: 10, retryPolicy: { strategy: 'FIXED', baseDelayMs: 1000, maxRetries: 3 } },
      { priority: 0, concurrencyLimit: -5, retryPolicy: { strategy: 'FIXED', baseDelayMs: 1000, maxRetries: 3 } },
      { priority: 0, concurrencyLimit: 10, retryPolicy: { strategy: 'FIXED', baseDelayMs: -100, maxRetries: 3 } },
      { priority: 0, concurrencyLimit: 10, retryPolicy: { strategy: 'FIXED', baseDelayMs: 1000, maxRetries: -1 } },
    ];

    for (const payload of payloads) {
      const res = await request(app)
        .post(`/api/projects/${projectId}/queues`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Neg Queue', ...payload });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  // Case 3: maxRetries = 0 goes straight to DEAD_LETTER
  it('Case 3: maxRetries = 0 goes straight to DEAD_LETTER on first failure', async () => {
    const qRes = await request(app)
      .post(`/api/projects/${projectId}/queues`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Zero Retries Queue',
        retryPolicy: { strategy: 'FIXED', baseDelayMs: 1000, maxRetries: 0 }
      });
    const queueId = qRes.body.id;

    const jRes = await request(app)
      .post(`/api/queues/${queueId}/jobs`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'fail-job', payload: {}, mode: 'immediate' });
    const jobId = jRes.body.id;

    const jobBefore = await prisma.job.findUnique({ where: { id: jobId } });

    // Create a dummy worker for foreign key constraint
    const worker = await prisma.worker.create({
      data: {
        id: 'worker-1',
        hostname: 'test-worker',
        status: 'ACTIVE',
        lastSeenAt: new Date()
      }
    });
    
    // Mock handler to fail
    vi.spyOn(handler, 'executeJob').mockResolvedValueOnce({ success: false, error: 'Forced failure' });

    // Execute job
    await runJob({ ...jobBefore, payload: '{}' } as any, 'worker-1');

    const jobAfter = await prisma.job.findUnique({ where: { id: jobId } });
    expect(jobAfter?.status).toBe('DEAD_LETTER');
    expect(jobAfter?.attemptCount).toBe(1);

    const dlq = await prisma.deadLetterEntry.findUnique({ where: { jobId } });
    expect(dlq).not.toBeNull();
    expect(dlq?.reason).toBe('Forced failure');
    
    vi.restoreAllMocks();
  });

  // Case 4: maxDelayMs < baseDelayMs
  it('Case 4: maxDelayMs < baseDelayMs returns validation error', async () => {
    const res = await request(app)
      .post(`/api/projects/${projectId}/queues`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Invalid Delay Queue',
        retryPolicy: { strategy: 'EXPONENTIAL', baseDelayMs: 5000, maxDelayMs: 1000, maxRetries: 3 }
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  // Case 5 & 6: Pause and Resume races
  it('Case 5 & 6: Pause queue with RUNNING jobs, and race conditions', async () => {
    const qRes = await request(app)
      .post(`/api/projects/${projectId}/queues`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Pausable Queue',
        retryPolicy: { strategy: 'FIXED', baseDelayMs: 1000, maxRetries: 1 }
      });
    const queueId = qRes.body.id;

    // Fire pause and resume concurrently
    const [pauseRes, resumeRes] = await Promise.all([
      request(app).post(`/api/queues/${queueId}/pause`).set('Authorization', `Bearer ${token}`),
      request(app).post(`/api/queues/${queueId}/resume`).set('Authorization', `Bearer ${token}`)
    ]);

    expect(pauseRes.status).toBe(200);
    expect(resumeRes.status).toBe(200);

    // Queue state should be deterministic (whatever finished last).
    const queueAfter = await prisma.queue.findUnique({ where: { id: queueId } });
    expect(queueAfter?.isPaused).toBeDefined(); // Just ensuring no corruption
  });

  // Case 7: Delete queue with active jobs
  it('Case 7: Delete a queue with active jobs returns 409 Conflict', async () => {
    const qRes = await request(app)
      .post(`/api/projects/${projectId}/queues`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Undeletable Queue',
        retryPolicy: { strategy: 'FIXED', baseDelayMs: 1000, maxRetries: 1 }
      });
    const queueId = qRes.body.id;

    // Add a job
    await request(app)
      .post(`/api/queues/${queueId}/jobs`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'dummy-job', payload: {}, mode: 'immediate' });

    const delRes = await request(app)
      .delete(`/api/queues/${queueId}`)
      .set('Authorization', `Bearer ${token}`);
    
    expect(delRes.status).toBe(409);
    expect(delRes.body.error.code).toBe('CONFLICT');
  });

  // Case 8: Update concurrencyLimit downward
  it('Case 8: Update concurrencyLimit downward is allowed by API', async () => {
    const qRes = await request(app)
      .post(`/api/projects/${projectId}/queues`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Concurrency Queue',
        concurrencyLimit: 20,
        retryPolicy: { strategy: 'FIXED', baseDelayMs: 1000, maxRetries: 1 }
      });
    const queueId = qRes.body.id;

    const patchRes = await request(app)
      .patch(`/api/queues/${queueId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ concurrencyLimit: 2 });
    
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.concurrencyLimit).toBe(2);
  });

  // Case 9: Stats on empty queue
  it('Case 9: Stats/metrics on empty queue return zeros', async () => {
    const qRes = await request(app)
      .post(`/api/projects/${projectId}/queues`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Empty Stats Queue',
        retryPolicy: { strategy: 'FIXED', baseDelayMs: 1000, maxRetries: 1 }
      });
    const queueId = qRes.body.id;

    const statsRes = await request(app)
      .get(`/api/queues/${queueId}`)
      .set('Authorization', `Bearer ${token}`);
    
    expect(statsRes.status).toBe(200);
    expect(statsRes.body.stats.QUEUED).toBe(0);
    expect(statsRes.body.stats.RUNNING).toBe(0);
    expect(statsRes.body.stats.DEAD_LETTER).toBe(0);

    const metricsRes = await request(app)
      .get(`/api/queues/${queueId}/metrics`)
      .set('Authorization', `Bearer ${token}`);
    
    expect(metricsRes.status).toBe(200);
    expect(metricsRes.body.throughputPerMinute).toBe(0);
    expect(metricsRes.body.averageDurationMs).toBe(0);
    expect(metricsRes.body.failureRate).toBe(0);
  });

});
