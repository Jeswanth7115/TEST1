import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import authRoutes from '../../src/routes/auth';
import orgsRoutes from '../../src/routes/orgs';
import projectsRoutes from '../../src/routes/projects';
import queuesRoutes from '../../src/routes/queues';
import jobsRoutes from '../../src/routes/jobs';

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/orgs', orgsRoutes);
app.use('/api', projectsRoutes);
app.use('/api', queuesRoutes);
app.use('/api', jobsRoutes);
import prisma from '../../src/prisma';

describe('Job Creation Edge Cases Suite', () => {
  let token: string;
  let projectId: string;
  let orgId: string;
  let queueId: string;

  beforeEach(async () => {
    const randomEmail = `jobadmin_${Date.now()}@test.com`;
    const signupRes = await request(app)
      .post('/api/auth/signup')
      .send({ email: randomEmail, password: 'password123', name: 'Job Admin' });
    token = signupRes.body.token;

    const orgsRes = await request(app).get('/api/orgs').set('Authorization', `Bearer ${token}`);
    orgId = orgsRes.body.data[0].id;

    const projRes = await request(app)
      .post(`/api/orgs/${orgId}/projects`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Job Test Project' });
    projectId = projRes.body.id;

    const qRes = await request(app)
      .post(`/api/projects/${projectId}/queues`)
      .set('Authorization', `Bearer ${token}`)
      .send({ 
        name: 'Job Test Queue',
        retryPolicy: { strategy: 'EXPONENTIAL', baseDelayMs: 1000, maxRetries: 3 }
      });
    queueId = qRes.body.id;
  });

  it('Case 1: Create a job with a runAt in the past returns validation error', async () => {
    const pastDate = new Date(Date.now() - 10000).toISOString();
    const res = await request(app)
      .post(`/api/queues/${queueId}/jobs`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'test',
        mode: 'scheduled',
        payload: { a: 1 },
        runAt: pastDate
      });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('runAt must be in the future');
  });

  it('Case 2: Create a delayed job with delayMs = 0 or negative returns validation error', async () => {
    const res0 = await request(app)
      .post(`/api/queues/${queueId}/jobs`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'test',
        mode: 'delayed',
        payload: { a: 1 },
        delayMs: 0
      });
    expect(res0.status).toBe(400);

    const resNeg = await request(app)
      .post(`/api/queues/${queueId}/jobs`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'test',
        mode: 'delayed',
        payload: { a: 1 },
        delayMs: -500
      });
    expect(resNeg.status).toBe(400);
  });

  it('Case 3: Create a recurring job with an invalid cron string returns validation error', async () => {
    const res = await request(app)
      .post(`/api/queues/${queueId}/jobs`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'test',
        mode: 'recurring',
        payload: { a: 1 },
        cronExpression: 'invalid-cron'
      });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body.error.details)).toContain('Invalid cron expression');
  });

  it('Case 4: Create a recurring job with a cron expression that fires every second is rejected', async () => {
    const res = await request(app)
      .post(`/api/queues/${queueId}/jobs`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'test',
        mode: 'recurring',
        payload: { a: 1 },
        cronExpression: '* * * * * *' // Valid in some parsers but interval is 1s
      });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body.error.details)).toContain('minimum 1 minute');
  });

  it('Case 5: Batch job creation with an empty array returns validation error', async () => {
    const res = await request(app)
      .post(`/api/queues/${queueId}/jobs`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'test',
        mode: 'batch',
        jobs: []
      });
    expect(res.status).toBe(400);
  });

  it('Case 6: Batch job creation with one invalid payload is all-or-nothing', async () => {
    // Generate a payload > 1MB
    const largePayload = 'a'.repeat(1000001);
    const res = await request(app)
      .post(`/api/queues/${queueId}/jobs`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'test',
        mode: 'batch',
        jobs: [
          { payload: { a: 1 } },
          { payload: largePayload }
        ]
      });
    expect(res.status).toBe(413); // Payload Too Large from express.json()

    // Verify nothing was inserted
    const jobsCount = await prisma.job.count({ where: { queueId } });
    expect(jobsCount).toBe(0);
  });

  it('Case 7: Create a job with a payload larger than 1MB is rejected cleanly', async () => {
    const largePayload = 'a'.repeat(1000001);
    const res = await request(app)
      .post(`/api/queues/${queueId}/jobs`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'test',
        mode: 'immediate',
        payload: largePayload
      });
    expect(res.status).toBe(413); // Payload Too Large from express.json()
  });

  it('Case 8: Create a job on a paused queue is accepted and sits QUEUED', async () => {
    // Pause queue
    await request(app)
      .patch(`/api/queues/${queueId}/pause`)
      .set('Authorization', `Bearer ${token}`);

    const res = await request(app)
      .post(`/api/queues/${queueId}/jobs`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'test',
        mode: 'immediate',
        payload: { a: 1 }
      });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('QUEUED');
  });

  it('Case 9: Create a job on a deleted queue returns 404', async () => {
    const fakeQueueId = '00000000-0000-0000-0000-000000000000';
    const res = await request(app)
      .post(`/api/queues/${fakeQueueId}/jobs`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'test',
        mode: 'immediate',
        payload: { a: 1 }
      });
    expect(res.status).toBe(404);
  });

  it('Case 10: Cancel (DELETE) a job that is RUNNING or COMPLETED is rejected', async () => {
    const jobRes = await request(app)
      .post(`/api/queues/${queueId}/jobs`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'test', mode: 'immediate', payload: {} });
    const jobId = jobRes.body.id;

    // Manually force to RUNNING
    await prisma.job.update({ where: { id: jobId }, data: { status: 'RUNNING' } });

    const delRes1 = await request(app).delete(`/api/jobs/${jobId}`).set('Authorization', `Bearer ${token}`);
    expect(delRes1.status).toBe(409);
    expect(delRes1.body.error.message).toContain('Only QUEUED or SCHEDULED');

    // Manually force to COMPLETED
    await prisma.job.update({ where: { id: jobId }, data: { status: 'COMPLETED' } });

    const delRes2 = await request(app).delete(`/api/jobs/${jobId}`).set('Authorization', `Bearer ${token}`);
    expect(delRes2.status).toBe(409);
  });

  it('Case 11: Retry a job that isn\'t FAILED or DEAD_LETTER is rejected', async () => {
    const jobRes = await request(app)
      .post(`/api/queues/${queueId}/jobs`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'test', mode: 'immediate', payload: {} });
    const jobId = jobRes.body.id;

    // It is QUEUED initially
    const retryRes1 = await request(app).post(`/api/jobs/${jobId}/retry`).set('Authorization', `Bearer ${token}`);
    expect(retryRes1.status).toBe(409);

    // Manually force to COMPLETED
    await prisma.job.update({ where: { id: jobId }, data: { status: 'COMPLETED' } });

    const retryRes2 = await request(app).post(`/api/jobs/${jobId}/retry`).set('Authorization', `Bearer ${token}`);
    expect(retryRes2.status).toBe(409);
  });
});
