import { Router, Response } from 'express';
import prisma from '../prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { catchAsync } from '../utils/catchAsync';
import { requireAdmin } from '../middleware/admin';
import { z } from 'zod';

const router = Router();
router.use(authenticate);

// GET /api/workers
router.get('/workers', catchAsync(async (req: AuthRequest, res: Response) => {
  // Only super-admins could see all, but for now we'll just return all workers for the dashboard.
  // The frontend needs to see list of Worker rows with status, lastSeenAt, and active job count.

  const workers = await prisma.worker.findMany({
    include: {
      _count: {
        select: {
          executions: {
            where: {
              status: 'RUNNING'
            }
          }
        }
      }
    }
  });

  const formattedWorkers = workers.map(w => ({
    id: w.id,
    hostname: w.hostname,
    status: w.status,
    lastSeenAt: w.lastSeenAt,
    activeJobCount: w._count.executions
  }));

  res.json({ data: formattedWorkers });
}));

router.post('/workers/nodes', requireAdmin, catchAsync(async (req: AuthRequest, res: Response) => {
  const hostname = z.string().min(1).max(255).parse(req.body.hostname);
  const worker = await prisma.worker.create({ data: { hostname, status: 'IDLE', lastSeenAt: new Date() } });
  res.status(201).json(worker);
}));

router.delete('/workers/:id', catchAsync(async (req: AuthRequest, res: Response) => {
  const workerId = req.params.id as string;
  const worker = await prisma.worker.findUnique({ where: { id: workerId } });
  if (!worker) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Worker not found', details: null } }); return; }
  const activeExecutions = await prisma.jobExecution.findMany({
    where: { workerId, status: 'RUNNING' },
    select: { id: true, jobId: true }
  });
  const claimedJobs = await prisma.job.findMany({
    where: { status: 'CLAIMED', claimedByWorkerId: workerId },
    select: { id: true }
  });
  await prisma.$transaction(async (tx) => {
    if (activeExecutions.length) {
      await tx.jobExecution.updateMany({
        where: { id: { in: activeExecutions.map((execution) => execution.id) }, status: 'RUNNING' },
        data: { status: 'FAILED', error: 'Worker removed by administrator', finishedAt: new Date() }
      });
      await tx.job.updateMany({
        where: { id: { in: activeExecutions.map((execution) => execution.jobId) }, status: { in: ['CLAIMED', 'RUNNING'] } },
        data: { status: 'QUEUED', runAt: new Date(), attemptCount: { increment: 1 } }
      });
    }
    if (claimedJobs.length) {
      await tx.job.updateMany({
        where: { id: { in: claimedJobs.map((job) => job.id) }, status: 'CLAIMED', claimedByWorkerId: workerId },
        data: { status: 'QUEUED', runAt: new Date(), attemptCount: { increment: 1 }, claimedByWorkerId: null, claimedAt: null }
      });
    }
    // The schema cascades completed execution history for an intentionally
    // deleted node. Active work was requeued above before this deletion.
    await tx.worker.delete({ where: { id: worker.id } });
  });
  res.json({ deletedWorkerId: worker.id, reclaimedJobs: activeExecutions.length + claimedJobs.length });
}));

export default router;
