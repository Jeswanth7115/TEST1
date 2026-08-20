import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import authRoutes from '../../src/routes/auth';
import orgsRoutes from '../../src/routes/orgs';
import projectsRoutes from '../../src/routes/projects';
import queuesRoutes from '../../src/routes/queues';
import jobsRoutes from '../../src/routes/jobs';
import prisma from '../../src/prisma';

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/orgs', orgsRoutes);
app.use('/api', projectsRoutes);
app.use('/api', queuesRoutes);
app.use('/api', jobsRoutes);

describe('Auth & Access Control Edge Cases Suite', () => {

  // Case 1: Signup with an already-registered email -> 409 Conflict
  it('Case 1: Signup with an already-registered email returns 409 Conflict', async () => {
    await request(app)
      .post('/api/auth/signup')
      .send({ email: 'duplicate@test.com', password: 'password123', name: 'User 1' });

    const res = await request(app)
      .post('/api/auth/signup')
      .send({ email: 'duplicate@test.com', password: 'password123', name: 'User 1 Dup' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
    expect(res.body.error.message).toBe('Email already in use');
  });

  // Case 2: Signup with malformed email, empty password, or short password -> 400 Validation Error
  it('Case 2: Signup with malformed email or invalid password returns 400 Validation Error', async () => {
    // Malformed email
    const res1 = await request(app)
      .post('/api/auth/signup')
      .send({ email: 'not-an-email', password: 'password123' });
    expect(res1.status).toBe(400);
    expect(res1.body.error.code).toBe('VALIDATION_ERROR');

    // Short password (< 6 chars)
    const res2 = await request(app)
      .post('/api/auth/signup')
      .send({ email: 'valid@test.com', password: '123' });
    expect(res2.status).toBe(400);
    expect(res2.body.error.code).toBe('VALIDATION_ERROR');

    // Empty password
    const res3 = await request(app)
      .post('/api/auth/signup')
      .send({ email: 'valid2@test.com', password: '' });
    expect(res3.status).toBe(400);
    expect(res3.body.error.code).toBe('VALIDATION_ERROR');
  });

  // Case 3: Login with correct email but wrong password -> 401 Unauthorized (generic message)
  it('Case 3: Login with correct email but wrong password returns generic 401', async () => {
    await request(app)
      .post('/api/auth/signup')
      .send({ email: 'user3@test.com', password: 'correctPassword123' });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'user3@test.com', password: 'wrongPassword123' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
    expect(res.body.error.message).toBe('Invalid credentials');
  });

  // Case 4: Login with non-existent email -> generic 401 (identical to wrong password)
  it('Case 4: Login with non-existent email returns generic 401', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nonexistent@test.com', password: 'somePassword123' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
    expect(res.body.error.message).toBe('Invalid credentials');
  });

  // Case 5: Access protected route with missing/malformed/expired/wrong secret token -> 401
  it('Case 5: Access protected route with missing/malformed/expired/wrong secret token returns 401', async () => {
    // 5a: No token
    const resNoToken = await request(app).get('/api/orgs');
    expect(resNoToken.status).toBe(401);
    expect(resNoToken.body.error.code).toBe('UNAUTHORIZED');

    // 5b: Malformed token
    const resMalformed = await request(app)
      .get('/api/orgs')
      .set('Authorization', 'Bearer invalid-token-string');
    expect(resMalformed.status).toBe(401);
    expect(resMalformed.body.error.code).toBe('UNAUTHORIZED');

    // 5c: Expired token
    const expiredToken = jwt.sign({ userId: 'fake-id', email: 'test@test.com' }, process.env.JWT_SECRET || 'your-super-secret-jwt-key', { expiresIn: '-1s' });
    const resExpired = await request(app)
      .get('/api/orgs')
      .set('Authorization', `Bearer ${expiredToken}`);
    expect(resExpired.status).toBe(401);
    expect(resExpired.body.error.code).toBe('UNAUTHORIZED');

    // 5d: Wrong secret token
    const wrongSecretToken = jwt.sign({ userId: 'fake-id', email: 'test@test.com' }, 'completely-wrong-secret-key');
    const resWrongSecret = await request(app)
      .get('/api/orgs')
      .set('Authorization', `Bearer ${wrongSecretToken}`);
    expect(resWrongSecret.status).toBe(401);
    expect(resWrongSecret.body.error.code).toBe('UNAUTHORIZED');
  });

  // Case 6: User A tries to GET/PATCH/DELETE User B's project, queue, or job -> 403 or 404
  it("Case 6: User A accessing User B's resources returns 403/404 without data leak", async () => {
    // Setup User A
    const userASignup = await request(app)
      .post('/api/auth/signup')
      .send({ email: 'userA@test.com', password: 'password123' });
    const tokenA = userASignup.body.token;

    // Fetch User A's default org, project, queue
    const orgsA = await request(app).get('/api/orgs').set('Authorization', `Bearer ${tokenA}`);
    const orgIdA = orgsA.body.data[0].id;

    const projectsA = await request(app).get(`/api/orgs/${orgIdA}/projects`).set('Authorization', `Bearer ${tokenA}`);
    const projectIdA = projectsA.body.data[0].id;

    const queuesA = await request(app).get(`/api/projects/${projectIdA}/queues`).set('Authorization', `Bearer ${tokenA}`);
    const queueIdA = queuesA.body.data[0].id;

    // Create a job in Queue A
    const jobARes = await request(app)
      .post(`/api/queues/${queueIdA}/jobs`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ type: 'test-job', payload: { test: true }, mode: 'immediate' });
    const jobIdA = jobARes.body.id;

    // Setup User B
    const userBSignup = await request(app)
      .post('/api/auth/signup')
      .send({ email: 'userB@test.com', password: 'password123' });
    const tokenB = userBSignup.body.token;

    // User B attempts to access User A's project
    const resBProject = await request(app)
      .get(`/api/projects/${projectIdA}`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect([403, 404]).toContain(resBProject.status);

    // User B attempts to access User A's queue
    const resBQueue = await request(app)
      .get(`/api/queues/${queueIdA}`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect([403, 404]).toContain(resBQueue.status);

    // User B attempts to delete User A's job
    const resBJobDelete = await request(app)
      .delete(`/api/jobs/${jobIdA}`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect([403, 404]).toContain(resBJobDelete.status);
  });

  // Case 7: User with no organization tries to create a project -> 403 Forbidden
  it('Case 7: User trying to create project in invalid org returns 403 Forbidden', async () => {
    const userSignup = await request(app)
      .post('/api/auth/signup')
      .send({ email: 'noorg@test.com', password: 'password123' });
    const token = userSignup.body.token;

    const res = await request(app)
      .post('/api/orgs/fake-org-uuid-9999/projects')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Unauthorized Project' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  // Case 8: Extremely long strings (10,000+ chars) -> rejected by validation
  it('Case 8: Extremely long strings (10,000+ chars) are rejected by validation', async () => {
    const longString = 'a'.repeat(10001);

    const res = await request(app)
      .post('/api/auth/signup')
      .send({ email: `long_${longString}@test.com`, password: 'password123', name: longString });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  // Case 9: SQL Injection style strings in text fields -> handled safely without syntax error or breach
  it('Case 9: SQL Injection style strings are handled safely by Prisma parameterization', async () => {
    const sqlInjectionEmail = "' OR '1'='1";

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: sqlInjectionEmail, password: "' OR '1'='1" });

    // Rejected by email validation schema or 401 Unauthorized
    expect([400, 401]).toContain(res.status);
    expect(res.status).not.toBe(500);
  });

  // Case 10: Concurrent signup with exact same email (race condition) -> exactly 1 succeeds, 1 gets 409
  it('Case 10: Concurrent signup with exact same email returns 201 for one and 409 for the other', async () => {
    const email = 'race_condition@test.com';
    const payload = { email, password: 'password123', name: 'Racer' };

    const [res1, res2] = await Promise.all([
      request(app).post('/api/auth/signup').send(payload),
      request(app).post('/api/auth/signup').send(payload)
    ]);

    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([201, 409]);

    // Verify DB count is exactly 1
    const userCount = await prisma.user.count({ where: { email } });
    expect(userCount).toBe(1);
  });

});
