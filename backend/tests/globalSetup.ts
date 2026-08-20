import { execSync } from 'child_process';

export function setup() {
  console.log('Global setup: Running Prisma DB push for test db...');
  process.env.DATABASE_URL = 'file:./test.db';
  execSync('npx prisma db push --skip-generate --accept-data-loss', { stdio: 'inherit' });
}
