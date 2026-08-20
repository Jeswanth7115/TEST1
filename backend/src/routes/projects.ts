import { Router, Response } from 'express';
import { z } from 'zod';
import prisma from '../prisma';
import { validateBody } from '../middleware/validate';
import { authenticate, AuthRequest } from '../middleware/auth';
import { catchAsync } from '../utils/catchAsync';
import { getPaginationParams } from '../utils/pagination';

const router = Router();
router.use(authenticate);

const createProjectSchema = z.object({
  name: z.string().min(1).max(255)
});

// Helper to check if user belongs to org
async function checkOrgAccess(userId: string, orgId: string): Promise<boolean> {
  const member = await prisma.organizationUser.findUnique({
    where: {
      userId_orgId: { userId, orgId }
    }
  });
  return !!member;
}

// POST /api/orgs/:orgId/projects
router.post('/orgs/:orgId/projects', validateBody(createProjectSchema), catchAsync(async (req: AuthRequest, res: Response) => {
  const orgId = req.params.orgId as string;
  const { name } = req.body;
  const userId = req.user!.userId;

  const hasAccess = await checkOrgAccess(userId, orgId);
  if (!hasAccess) {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You do not have access to this organization', details: null } });
  }

  const project = await prisma.project.create({
    data: { name, orgId }
  });

  const checkDb = await prisma.project.findMany();
  console.log('[projects.ts] Created project:', project.id, 'DB count:', checkDb.length, 'DB URL:', process.env.DATABASE_URL);

  res.status(201).json(project);
}));

// GET /api/orgs/:orgId/projects
router.get('/orgs/:orgId/projects', catchAsync(async (req: AuthRequest, res: Response) => {
  const orgId = req.params.orgId as string;
  const userId = req.user!.userId;

  const hasAccess = await checkOrgAccess(userId, orgId);
  if (!hasAccess) {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You do not have access to this organization', details: null } });
  }

  const { page, limit, skip, take } = getPaginationParams(req);
  const where = { orgId };

  const [data, total] = await Promise.all([
    prisma.project.findMany({ where, skip, take }),
    prisma.project.count({ where })
  ]);

  res.json({ data, meta: { page, limit, total } });
}));

// GET /api/projects/:id
router.get('/projects/:id', catchAsync(async (req: AuthRequest, res: Response) => {
  const id = req.params.id as string;
  const userId = req.user!.userId;

  const project = await prisma.project.findUnique({ where: { id } });
  if (!project) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Project not found', details: null } });
  }

  const hasAccess = await checkOrgAccess(userId, project.orgId);
  if (!hasAccess) {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You do not have access to this project', details: null } });
  }

  res.json(project);
}));

// DELETE /api/projects/:id
router.delete('/projects/:id', catchAsync(async (req: AuthRequest, res: Response) => {
  const id = req.params.id as string;
  const userId = req.user!.userId;

  const project = await prisma.project.findUnique({ where: { id } });
  if (!project) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Project not found', details: null } });
  }

  const hasAccess = await checkOrgAccess(userId, project.orgId);
  if (!hasAccess) {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You do not have access to this project', details: null } });
  }

  await prisma.project.delete({ where: { id } });
  res.status(204).send();
}));

export default router;
