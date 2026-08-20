import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function seed() {
  const email = `testuser_${Date.now()}@example.com`;
  console.log(`Seeding user: ${email} with password: secret`);
  
  // We'll just let the UI handle signup, so we'll just print the email to use.
  console.log('Use these credentials in the UI:');
  console.log(`Email: ${email}`);
  console.log('Password: secret');
  console.log('Name: Test User');
}

seed();
