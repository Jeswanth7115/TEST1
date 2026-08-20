import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import projectsRoutes from '../../src/routes/projects';
import prisma from '../../src/prisma';
import { sign } from 'jsonwebtoken';

const app = express();
app.use(express.json());
app.use('/api', projectsRoutes);

// Helper to generate a valid test token
function createToken(userId: string, email: string) {
  return sign({ userId, email }, process.env.JWT_SECRET || 'test-secret');
}

describe('Projects API Access Control', () => {
  let userA: any;
  let userB: any;
  let orgA: any;
  let orgB: any;

  beforeEach(async () => {
    userA = await prisma.user.create({ data: { email: 'usera@test.com', passwordHash: 'hash', role: 'USER' } });
    userB = await prisma.user.create({ data: { email: 'userb@test.com', passwordHash: 'hash', role: 'USER' } });

    orgA = await prisma.organization.create({ data: { name: 'Org A' } });
    orgB = await prisma.organization.create({ data: { name: 'Org B' } });

    // User A belongs to Org A, User B belongs to Org B
    await prisma.organizationUser.create({ data: { userId: userA.id, orgId: orgA.id, role: 'OWNER' } });
    await prisma.organizationUser.create({ data: { userId: userB.id, orgId: orgB.id, role: 'OWNER' } });
  });

  it('prevents user A from accessing user B projects', async () => {
    const tokenA = createToken(userA.id, userA.email);

    // Try to access Org B's projects as User A
    const res = await request(app)
      .get(`/api/orgs/${orgB.id}/projects`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('allows user A to access their own org projects', async () => {
    const tokenA = createToken(userA.id, userA.email);

    const res = await request(app)
      .get(`/api/orgs/${orgA.id}/projects`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toBeInstanceOf(Array);
  });
});
