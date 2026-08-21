import { Response, NextFunction } from 'express';
import prisma from '../prisma';
import { AuthRequest } from './auth';

export async function requireAdmin(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const user = req.user?.userId ? await prisma.user.findUnique({ where: { id: req.user.userId }, select: { role: true } }) : null;
  if (!user || !['ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
    res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Administrator access is required', details: null } });
    return;
  }
  next();
}