import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import prisma from '../prisma';
import { validateBody } from '../middleware/validate';
import { authenticate, AuthRequest } from '../middleware/auth';
import { timingSafeEqual } from 'crypto';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key';
const ADMIN_REGISTRATION_PASSKEY = process.env.ADMIN_REGISTRATION_PASSKEY || '';

const DUMMY_HASH = '$2a$10$abcdefghijklmnopqrstuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuu';

const signupSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(6).max(100),
  name: z.string().max(255).optional()
});

const loginSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().max(100)
});

const adminSignupSchema = signupSchema.extend({
  adminPasskey: z.string().min(1).max(200)
});

function matchesAdminPasskey(candidate: string): boolean {
  if (!ADMIN_REGISTRATION_PASSKEY) return false;
  const candidateBuffer = Buffer.from(candidate);
  const configuredBuffer = Buffer.from(ADMIN_REGISTRATION_PASSKEY);
  return candidateBuffer.length === configuredBuffer.length && timingSafeEqual(candidateBuffer, configuredBuffer);
}

router.post('/signup', validateBody(signupSchema), async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password, name } = req.body;
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      res.status(409).json({ error: { code: 'CONFLICT', message: 'Email already in use', details: null } });
      return;
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { email, passwordHash, name, role: 'USER' },
      select: { id: true, email: true, name: true, role: true, createdAt: true }
    });
    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ user, token });
  } catch (error: any) {
    if (error?.code === 'P2002') {
      res.status(409).json({ error: { code: 'CONFLICT', message: 'Email already in use', details: null } });
      return;
    }
    res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Something went wrong', details: null } });
  }
});

router.post('/admin/signup', validateBody(adminSignupSchema), async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password, name, adminPasskey } = req.body;
    if (!matchesAdminPasskey(adminPasskey)) {
      res.status(403).json({ error: { code: 'INVALID_ADMIN_PASSKEY', message: 'Invalid administrator registration passkey', details: null } });
      return;
    }
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      res.status(409).json({ error: { code: 'CONFLICT', message: 'Email already in use', details: null } });
      return;
    }
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { email, passwordHash, name, role: 'ADMIN' },
      select: { id: true, email: true, name: true, role: true, createdAt: true }
    });
    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ user, token });
  } catch (error: any) {
    if (error?.code === 'P2002') {
      res.status(409).json({ error: { code: 'CONFLICT', message: 'Email already in use', details: null } });
      return;
    }
    res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Something went wrong', details: null } });
  }
});

router.post('/login', validateBody(loginSchema), async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      // Run dummy bcrypt check to neutralize timing attacks
      await bcrypt.compare(password, DUMMY_HASH);
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid credentials', details: null } });
      return;
    }
    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid credentials', details: null } });
      return;
    }
    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    const { passwordHash, ...userWithoutPassword } = user;
    res.json({ user: userWithoutPassword, token });
  } catch (error) {
    res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Something went wrong', details: null } });
  }
});

router.get('/me', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { id: true, email: true, name: true, role: true, createdAt: true }
    });
    if (!user) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found', details: null } });
      return;
    }
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Something went wrong', details: null } });
  }
});

export default router;
