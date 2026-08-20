import { Router, Response } from 'express';
import { z } from 'zod';
import prisma from '../prisma';
import { validateBody } from '../middleware/validate';
import { authenticate, AuthRequest } from '../middleware/auth';
import { catchAsync } from '../utils/catchAsync';
import { getPaginationParams } from '../utils/pagination';

const router = Router();
router.use(authenticate);

const retryPolicySchema = z.object({
  strategy: z.enum(['FIXED', 'LINEAR', 'EXPONENTIAL']),
  baseDelayMs: z.number().int().min(0),
  maxRetries: z.number().int().min(0),
  maxDelayMs: z.number().int().min(0).optional()
}).superRefine((data, ctx) => {
  if (data.maxDelayMs !== undefined && data.maxDelayMs < data.baseDelayMs) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'maxDelayMs cannot be smaller than baseDelayMs'
    });
  }
});

const createQueueSchema = z.object({
  name: z.string().min(1).max(255),
  priority: z.number().int().min(0).default(0),
  concurrencyLimit: z.number().int().min(1).default(10),
  retryPolicy: retryPolicySchema
});

const updateQueueSchema = z.object({
  priority: z.number().int().min(0).optional(),
  concurrencyLimit: z.number().int().min(1).optional(),
  retryPolicy: retryPolicySchema.optional()
});

async function checkProjectAccess(userId: string, projectId: string): Promise<boolean> {
  console.log(`[checkProjectAccess] Searching for project with ID:`, JSON.stringify(projectId));
  const allProjects = await prisma.project.findMany();
  console.log(`[checkProjectAccess] All projects in DB:`, allProjects.map(p => p.id));
  const project = await prisma.project.findUnique({
    where: { id: projectId }
  });
  if (!project) {
    console.log(`[checkProjectAccess] Project not found!`);
    return false;
  }
  
  const member = await prisma.organizationUser.findUnique({
    where: {
      userId_orgId: { userId, orgId: project.orgId }
    }
  });
  console.log(`[checkProjectAccess] userId=${userId} orgId=${project.orgId} member=${!!member}`);
  return !!member;
}

// POST /api/projects/:projectId/queues
router.post('/projects/:projectId/queues', validateBody(createQueueSchema), catchAsync(async (req: AuthRequest, res: Response) => {
  const projectId = req.params.projectId as string;
  const userId = req.user!.userId;

  const hasAccess = await checkProjectAccess(userId, projectId);
  if (!hasAccess) {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You do not have access to this project', details: null } });
  }

  const { name, priority, concurrencyLimit, retryPolicy } = req.body;

  const queue = await prisma.$transaction(async (tx) => {
    const rp = await tx.retryPolicy.create({ data: retryPolicy });
    return tx.queue.create({
      data: {
        name,
        priority,
        concurrencyLimit,
        projectId,
        defaultRetryPolicyId: rp.id
      },
      include: { retryPolicy: true }
    });
  });

  res.status(201).json(queue);
}));

// GET /api/projects/:projectId/queues
router.get('/projects/:projectId/queues', catchAsync(async (req: AuthRequest, res: Response) => {
  const projectId = req.params.projectId as string;
  const userId = req.user!.userId;

  const hasAccess = await checkProjectAccess(userId, projectId);
  if (!hasAccess) {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You do not have access to this project', details: null } });
  }

  const { page, limit, skip, take } = getPaginationParams(req);
  const where = { projectId };

  const [data, total] = await Promise.all([
    prisma.queue.findMany({ where, skip, take, include: { retryPolicy: true } }),
    prisma.queue.count({ where })
  ]);

  res.json({ data, meta: { page, limit, total } });
}));

// GET /api/queues/:id
router.get('/queues/:id', catchAsync(async (req: AuthRequest, res: Response) => {
  const id = req.params.id as string;
  const userId = req.user!.userId;

  const queue = await prisma.queue.findUnique({
    where: { id },
    include: { retryPolicy: true }
  });

  if (!queue) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Queue not found', details: null } });
  }

  const hasAccess = await checkProjectAccess(userId, queue.projectId);
  if (!hasAccess) {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You do not have access to this queue', details: null } });
  }

  const statusCounts = await prisma.job.groupBy({
    by: ['status'],
    where: { queueId: id },
    _count: true
  });

  const stats = { QUEUED: 0, SCHEDULED: 0, CLAIMED: 0, RUNNING: 0, COMPLETED: 0, FAILED: 0, DEAD_LETTER: 0 };
  statusCounts.forEach(stat => {
    stats[stat.status as keyof typeof stats] = stat._count;
  });

  res.json({ ...queue, stats });
}));

// GET /api/queues/:id/metrics
router.get('/queues/:id/metrics', catchAsync(async (req: AuthRequest, res: Response) => {
  const id = req.params.id as string;
  const userId = req.user!.userId;

  const queue = await prisma.queue.findUnique({ where: { id } });
  if (!queue) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Queue not found', details: null } });
  }

  const hasAccess = await checkProjectAccess(userId, queue.projectId);
  if (!hasAccess) {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You do not have access to this queue', details: null } });
  }

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  const executions = await prisma.jobExecution.findMany({
    where: {
      job: { queueId: id },
      startedAt: { gte: oneHourAgo }
    },
    select: { status: true, startedAt: true, finishedAt: true }
  });

  let totalCompleted = 0;
  let totalFailed = 0;
  let totalDurationMs = 0;

  for (const exec of executions) {
    if (exec.status === 'COMPLETED') {
      totalCompleted++;
      if (exec.finishedAt) {
        totalDurationMs += exec.finishedAt.getTime() - exec.startedAt.getTime();
      }
    } else if (exec.status === 'FAILED') {
      totalFailed++;
    }
  }

  const throughputPerMinute = totalCompleted / 60;
  const averageDurationMs = totalCompleted > 0 ? totalDurationMs / totalCompleted : 0;
  const totalFinished = totalCompleted + totalFailed;
  const failureRate = totalFinished > 0 ? totalFailed / totalFinished : 0;

  res.json({
    throughputPerMinute,
    averageDurationMs,
    failureRate
  });
}));

// PATCH /api/queues/:id
router.patch('/queues/:id', validateBody(updateQueueSchema), catchAsync(async (req: AuthRequest, res: Response) => {
  const id = req.params.id as string;
  const userId = req.user!.userId;
  const { priority, concurrencyLimit, retryPolicy } = req.body;

  const queue = await prisma.queue.findUnique({ where: { id } });
  if (!queue) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Queue not found', details: null } });

  const hasAccess = await checkProjectAccess(userId, queue.projectId);
  if (!hasAccess) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You do not have access to this queue', details: null } });

  const updatedQueue = await prisma.$transaction(async (tx) => {
    if (retryPolicy && queue.defaultRetryPolicyId) {
      await tx.retryPolicy.update({
        where: { id: queue.defaultRetryPolicyId },
        data: retryPolicy
      });
    } else if (retryPolicy && !queue.defaultRetryPolicyId) {
      const rp = await tx.retryPolicy.create({ data: retryPolicy });
      return tx.queue.update({
        where: { id },
        data: {
          ...(priority !== undefined && { priority }),
          ...(concurrencyLimit !== undefined && { concurrencyLimit }),
          defaultRetryPolicyId: rp.id
        },
        include: { retryPolicy: true }
      });
    }

    return tx.queue.update({
      where: { id },
      data: {
        ...(priority !== undefined && { priority }),
        ...(concurrencyLimit !== undefined && { concurrencyLimit })
      },
      include: { retryPolicy: true }
    });
  });

  res.json(updatedQueue);
}));

// POST /api/queues/:id/pause
router.post('/queues/:id/pause', catchAsync(async (req: AuthRequest, res: Response) => {
  const id = req.params.id as string;
  const userId = req.user!.userId;

  const queue = await prisma.queue.findUnique({ where: { id } });
  if (!queue) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Queue not found', details: null } });

  const hasAccess = await checkProjectAccess(userId, queue.projectId);
  if (!hasAccess) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You do not have access to this queue', details: null } });

  const updated = await prisma.queue.update({ where: { id }, data: { isPaused: true } });
  res.json(updated);
}));

// POST /api/queues/:id/resume
router.post('/queues/:id/resume', catchAsync(async (req: AuthRequest, res: Response) => {
  const id = req.params.id as string;
  const userId = req.user!.userId;

  const queue = await prisma.queue.findUnique({ where: { id } });
  if (!queue) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Queue not found', details: null } });

  const hasAccess = await checkProjectAccess(userId, queue.projectId);
  if (!hasAccess) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You do not have access to this queue', details: null } });

  const updated = await prisma.queue.update({ where: { id }, data: { isPaused: false } });
  res.json(updated);
}));

// DELETE /api/queues/:id
router.delete('/queues/:id', catchAsync(async (req: AuthRequest, res: Response) => {
  const id = req.params.id as string;
  const userId = req.user!.userId;

  const queue = await prisma.queue.findUnique({ where: { id } });
  if (!queue) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Queue not found', details: null } });

  const hasAccess = await checkProjectAccess(userId, queue.projectId);
  if (!hasAccess) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You do not have access to this queue', details: null } });

  const activeJobsCount = await prisma.job.count({
    where: {
      queueId: id,
      status: { in: ['QUEUED', 'SCHEDULED', 'CLAIMED', 'RUNNING'] }
    }
  });

  if (activeJobsCount > 0) {
    return res.status(409).json({ error: { code: 'CONFLICT', message: 'Cannot delete queue with active or queued jobs', details: null } });
  }

  await prisma.$transaction(async (tx) => {
    await tx.queue.delete({ where: { id } });
    if (queue.defaultRetryPolicyId) {
      await tx.retryPolicy.delete({ where: { id: queue.defaultRetryPolicyId } });
    }
  });

  res.status(204).send();
}));

export default router;
