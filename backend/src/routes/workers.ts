import { Router, Response } from 'express';
import prisma from '../prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { catchAsync } from '../utils/catchAsync';

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

export default router;
