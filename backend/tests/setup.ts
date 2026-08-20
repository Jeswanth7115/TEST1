import { beforeEach, afterAll } from 'vitest';
import prisma from '../src/prisma';

beforeEach(async () => {
  // Truncate all tables in SQLite
  // Order matters for foreign keys, or we can just delete from all tables
  const tableNames = [
    'DeadLetterEntry',
    'JobExecution',
    'Job',
    'ScheduledJob',
    'WorkerHeartbeat',
    'Worker',
    'Queue',
    'RetryPolicy',
    'Project',
    'OrganizationUser',
    'User',
    'Organization'
  ];

  for (const tableName of tableNames) {
    try {
      await prisma.$executeRawUnsafe(`DELETE FROM "${tableName}";`);
    } catch (err) {
      console.warn(`Failed to truncate ${tableName}:`, err);
    }
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});
