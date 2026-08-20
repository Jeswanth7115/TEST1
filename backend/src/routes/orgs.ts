import { Router, Response } from 'express';
import { z } from 'zod';
import prisma from '../prisma';
import { validateBody } from '../middleware/validate';
import { authenticate, AuthRequest } from '../middleware/auth';
import { catchAsync } from '../utils/catchAsync';
import { getPaginationParams } from '../utils/pagination';

const router = Router();

const createOrgSchema = z.object({
  name: z.string().min(1).max(255)
});

router.use(authenticate);

router.post('/', validateBody(createOrgSchema), catchAsync(async (req: AuthRequest, res: Response) => {
  const { name } = req.body;
  const userId = req.user!.userId;

  const org = await prisma.organization.create({
    data: {
      name,
      users: {
        create: {
          userId,
          role: 'OWNER'
        }
      }
    }
  });

  res.status(201).json(org);
}));

router.get('/', catchAsync(async (req: AuthRequest, res: Response) => {
  const userId = req.user!.userId;
  const { page, limit, skip, take } = getPaginationParams(req);

  const where = {
    users: {
      some: { userId }
    }
  };

  let [data, total] = await Promise.all([
    prisma.organization.findMany({ where, skip, take }),
    prisma.organization.count({ where })
  ]);

  if (total === 0) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const orgName = user?.name ? `${user.name}'s Org` : 'My Organization';
    
    // Auto-create default org, project, and queue
    const org = await prisma.organization.create({
      data: {
        name: orgName,
        users: {
          create: {
            userId,
            role: 'OWNER'
          }
        }
      }
    });

    const project = await prisma.project.create({
      data: {
        name: 'Default Project',
        orgId: org.id
      }
    });

    let retryPolicy = await prisma.retryPolicy.findFirst();
    if (!retryPolicy) {
      retryPolicy = await prisma.retryPolicy.create({
        data: { strategy: 'FIXED', baseDelayMs: 1000, maxRetries: 3 }
      });
    }

    await prisma.queue.create({
      data: {
        name: 'default-queue',
        projectId: project.id,
        defaultRetryPolicyId: retryPolicy.id
      }
    });

    data = [org];
    total = 1;
  }

  res.json({ data, meta: { page, limit, total } });
}));

export default router;
