import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import authRoutes from '../../src/routes/auth';
import orgsRoutes from '../../src/routes/orgs';

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/orgs', orgsRoutes);

describe('Auth API', () => {
  it('rejects protected routes without token', async () => {
    const res = await request(app).get('/api/orgs');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('allows signup and login', async () => {
    // Signup
    const signupRes = await request(app)
      .post('/api/auth/signup')
      .send({ email: 'test@api.com', password: 'password123', name: 'Test' });
    
    expect(signupRes.status).toBe(201);
    expect(signupRes.body.token).toBeDefined();

    // Login
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@api.com', password: 'password123' });
    
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.token).toBeDefined();

    // Access protected route with token
    const orgsRes = await request(app)
      .get('/api/orgs')
      .set('Authorization', `Bearer ${loginRes.body.token}`);
    
    expect(orgsRes.status).toBe(200); // Because token is valid, even if it returns empty array
  });
});
