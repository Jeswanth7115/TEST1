import { Router, Response } from 'express';
import { z } from 'zod';
import { CronExpressionParser } from 'cron-parser';
import prisma from '../prisma';
import { validateBody } from '../middleware/validate';
import { authenticate, AuthRequest } from '../middleware/auth';
import { catchAsync } from '../utils/catchAsync';
import { getPaginationParams } from '../utils/pagination';
import { requireAdmin } from '../middleware/admin';

const router = Router();
router.use(authenticate);

// ── Helpers ──────────────────────────────────────────────────

async function checkQueueAccess(userId: string, queueId: string): Promise<{ exists: boolean; allowed: boolean }> {
  const queue = await prisma.queue.findUnique({
    where: { id: queueId },
    include: { project: true }
  });
  if (!queue) return { exists: false, allowed: false };
  
  const member = await prisma.organizationUser.findUnique({
    where: { userId_orgId: { userId, orgId: queue.project.orgId } }
  });
  
  return { exists: true, allowed: !!member };
}

async function checkJobAccess(userId: string, jobId: string): Promise<{ exists: boolean; allowed: boolean; job: any }> {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) return { exists: false, allowed: false, job: null };
  const { allowed } = await checkQueueAccess(userId, job.queueId);
  return { exists: true, allowed, job };
}

function isValidCron(expression: string): boolean {
  try {
    const cron = CronExpressionParser.parse(expression);
    const next1 = cron.next().getTime();
    const next2 = cron.next().getTime();
    if (next2 - next1 < 60000) {
      return false; // Reject expressions that fire more often than every 1 minute
    }
    return true;
  } catch {
    return false;
  }
}

const payloadSchema = z.any().refine((val) => {
  const str = typeof val === 'string' ? val : JSON.stringify(val);
  return str.length <= 1000000; // max 1MB
}, { message: 'Payload exceeds 1MB limit' });

// ── Zod Schemas ──────────────────────────────────────────────

const immediateSchema = z.object({
  type: z.string().min(1),
  payload: payloadSchema,
  mode: z.literal('immediate'),
  demoMode: z.boolean().optional().default(false)
});

const delayedSchema = z.object({
  type: z.string().min(1),
  payload: payloadSchema,
  mode: z.literal('delayed'),
  delayMs: z.number().int().min(1).max(86400000 * 30), // max 30 days
  demoMode: z.boolean().optional().default(false)
});

const scheduledSchema = z.object({
  type: z.string().min(1),
  payload: payloadSchema,
  mode: z.literal('scheduled'),
  runAt: z.string().datetime(),
  demoMode: z.boolean().optional().default(false)
});

const recurringSchema = z.object({
  type: z.string().min(1),
  payload: payloadSchema,
  mode: z.literal('recurring'),
  cronExpression: z.string().min(1, 'cronExpression must not be empty').refine(isValidCron, { message: 'Invalid cron expression or interval too short (minimum 1 minute)' }),
  timezone: z.string().min(1).optional().default('UTC'),
  demoMode: z.boolean().optional().default(false)
});

const batchSchema = z.object({
  type: z.string().min(1),
  mode: z.literal('batch'),
  jobs: z.array(z.object({
    type: z.string().min(1).optional(),
    payload: payloadSchema,
    demoMode: z.boolean().optional().default(false)
  })).min(1).max(1000)
});

const createJobSchema = z.discriminatedUnion('mode', [
  immediateSchema,
  delayedSchema,
  scheduledSchema,
  recurringSchema,
  batchSchema
]);

// ── POST /api/queues/:queueId/jobs ───────────────────────────

router.post('/queues/:queueId/jobs', validateBody(createJobSchema), catchAsync(async (req: AuthRequest, res: Response) => {
  const queueId = req.params.queueId as string;
  const userId = req.user!.userId;
  const idempotencyKey = req.headers['idempotency-key'] as string | undefined;

  const { exists, allowed } = await checkQueueAccess(userId, queueId);
  if (!exists) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Queue not found', details: null } });
  }
  if (!allowed) {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You do not have access to this queue', details: null } });
  }

  // Handle Idempotency
  if (idempotencyKey) {
    const existingJob = await prisma.job.findUnique({ where: { idempotencyKey } });
    if (existingJob) {
      return res.status(200).json(existingJob);
    }
  }

  const body = req.body;
  const payloadStr = (p: any) => typeof p === 'string' ? p : JSON.stringify(p);

  switch (body.mode) {
    case 'immediate': {
      const job = await prisma.job.create({
        data: {
          queueId,
          type: body.type,
          payload: payloadStr(body.payload),
          status: 'QUEUED',
          runAt: new Date(),
          demoMode: body.demoMode,
          idempotencyKey
        }
      });
      return res.status(201).json(job);
    }

    case 'delayed': {
      const runAt = new Date(Date.now() + body.delayMs);
      const job = await prisma.job.create({
        data: {
          queueId,
          type: body.type,
          payload: payloadStr(body.payload),
          status: 'SCHEDULED',
          runAt,
          demoMode: body.demoMode,
          idempotencyKey
        }
      });
      return res.status(201).json(job);
    }

    case 'scheduled': {
      const runAt = new Date(body.runAt);
      if (runAt.getTime() < Date.now()) {
        return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'runAt must be in the future', details: null } });
      }
      const job = await prisma.job.create({
        data: {
          queueId,
          type: body.type,
          payload: payloadStr(body.payload),
          status: 'SCHEDULED',
          runAt,
          demoMode: body.demoMode,
          idempotencyKey
        }
      });
      return res.status(201).json(job);
    }

    case 'recurring': {
      const cron = CronExpressionParser.parse(body.cronExpression, { tz: body.timezone });
      const nextRunAt = cron.next().toDate();

      const result = await prisma.$transaction(async (tx) => {
        const job = await tx.job.create({
          data: {
            queueId,
            type: body.type,
            payload: payloadStr(body.payload),
            status: 'SCHEDULED',
            cronExpression: body.cronExpression,
            runAt: nextRunAt,
            demoMode: body.demoMode,
            idempotencyKey
          }
        });
        const scheduledJob = await tx.scheduledJob.create({
          data: {
            jobId: job.id,
            cronExpression: body.cronExpression,
            timezone: body.timezone,
            nextRunAt
          }
        });
        return { ...job, scheduledJob };
      });

      return res.status(201).json(result);
    }

    case 'batch': {
      const batchId = crypto.randomUUID();
      const jobs = await prisma.$transaction(
        body.jobs.map((j: { type?: string; payload: any; demoMode?: boolean }) =>
          prisma.job.create({
            data: {
              queueId,
              type: j.type || body.type,
              payload: payloadStr(j.payload),
              status: 'QUEUED',
              batchId,
              demoMode: j.demoMode ?? false,
              runAt: new Date()
            }
          })
        )
      );
      return res.status(201).json({ batchId, count: jobs.length, jobs });
    }
  }
}));

// ── GET /api/queues/:queueId/jobs ────────────────────────────

router.get('/queues/:queueId/jobs', catchAsync(async (req: AuthRequest, res: Response) => {
  const queueId = req.params.queueId as string;
  const userId = req.user!.userId;

  const { exists, allowed } = await checkQueueAccess(userId, queueId);
  if (!exists) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Queue not found', details: null } });
  }
  if (!allowed) {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You do not have access to this queue', details: null } });
  }

  const { page, limit, skip, take } = getPaginationParams(req);

  // Build filter
  const where: any = { queueId };
  if (req.query.status) where.status = req.query.status;
  if (req.query.type) where.type = req.query.type;
  if (req.query.from || req.query.to) {
    where.createdAt = {};
    if (req.query.from) where.createdAt.gte = new Date(req.query.from as string);
    if (req.query.to) where.createdAt.lte = new Date(req.query.to as string);
  }

  const [jobs, total] = await Promise.all([
    prisma.job.findMany({
      where,
      skip,
      take,
      orderBy: { createdAt: 'desc' },
      include: {
        executions: {
          orderBy: { startedAt: 'desc' },
          take: 1,
          include: { worker: { select: { id: true, hostname: true, status: true } } }
        }
      }
    }),
    prisma.job.count({ where })
  ]);

  res.json({ data: jobs, meta: { page, limit, total } });
}));

// ── GET /api/jobs/:id ────────────────────────────────────────

router.get('/jobs/:id', catchAsync(async (req: AuthRequest, res: Response) => {
  const id = req.params.id as string;
  const userId = req.user!.userId;

  const job = await prisma.job.findUnique({
    where: { id },
    include: {
      executions: true,
      logs: { orderBy: { timestamp: 'asc' } },
      scheduledJobs: true,
      deadLetter: true
    }
  });

  if (!job) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Job not found', details: null } });
  }

  const { exists, allowed } = await checkQueueAccess(userId, job.queueId);
  if (!exists) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Queue not found', details: null } });
  }
  if (!allowed) {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You do not have access to this job', details: null } });
  }

  res.json(job);
}));

// ── POST /api/jobs/:id/retry ─────────────────────────────────

router.post('/jobs/:id/retry', catchAsync(async (req: AuthRequest, res: Response) => {
  const id = req.params.id as string;
  const userId = req.user!.userId;

  const { exists, allowed, job } = await checkJobAccess(userId, id);
  if (!exists || !job) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Job not found', details: null } });
  }
  if (!allowed) {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You do not have access to this job', details: null } });
  }

  if (!['FAILED', 'DEAD_LETTER'].includes(job.status)) {
    return res.status(409).json({ error: { code: 'CONFLICT', message: `Cannot retry a job with status "${job.status}". Only FAILED or DEAD_LETTER jobs can be retried.`, details: null } });
  }

  const updated = await prisma.$transaction(async (tx) => {
    // Remove dead letter entry if exists
    if (job.status === 'DEAD_LETTER') {
      await tx.deadLetterEntry.deleteMany({ where: { jobId: id } });
    }
    return tx.job.update({
      where: { id },
      data: {
        status: 'QUEUED',
        runAt: new Date(),
        attemptCount: 0
      }
    });
  });

  res.json(updated);
}));

router.post('/jobs/:id/ticket', validateBody(z.object({ reason: z.string().min(5).max(1000) })), catchAsync(async (req: AuthRequest, res: Response) => {
  const jobId = req.params.id as string;
  const { exists, allowed } = await checkJobAccess(req.user!.userId, jobId);
  if (!exists) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Job not found', details: null } }); return; }
  if (!allowed) { res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You do not have access to this job', details: null } }); return; }
  const ticket = await prisma.adminTicket.create({ data: { jobId, createdById: req.user!.userId, reason: req.body.reason } });
  res.status(201).json(ticket);
}));

router.get('/admin/tickets', requireAdmin, catchAsync(async (req: AuthRequest, res: Response) => {
  const tickets = await prisma.adminTicket.findMany({ where: { status: 'OPEN' }, include: { job: true, createdBy: { select: { name: true, email: true } } }, orderBy: { createdAt: 'desc' } });
  res.json({ data: tickets });
}));

router.delete('/admin/jobs/:id', requireAdmin, catchAsync(async (req: AuthRequest, res: Response) => {
  const jobId = req.params.id as string;
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Job not found', details: null } }); return; }
  await prisma.$transaction([
    prisma.adminTicket.updateMany({ where: { jobId: job.id, status: 'OPEN' }, data: { status: 'RESOLVED' } }),
    prisma.job.delete({ where: { id: job.id } })
  ]);
  res.status(204).send();
}));

// ── DELETE /api/jobs/:id ─────────────────────────────────────

router.delete('/jobs/:id', catchAsync(async (req: AuthRequest, res: Response) => {
  const id = req.params.id as string;
  const userId = req.user!.userId;

  const { exists, allowed, job } = await checkJobAccess(userId, id);
  if (!exists || !job) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Job not found', details: null } });
  }
  if (!allowed) {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You do not have access to this job', details: null } });
  }

  if (!['QUEUED', 'SCHEDULED'].includes(job.status)) {
    return res.status(409).json({ error: { code: 'CONFLICT', message: `Cannot cancel a job with status "${job.status}". Only QUEUED or SCHEDULED jobs can be cancelled.`, details: null } });
  }

  await prisma.job.delete({ where: { id } });
  res.status(204).send();
}));

export default router;
