import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function runDemoSeed() {
  console.log('🌱 Generating demo projects, queues, and jobs...');

  // 1. Get or create a default user
  let user = await prisma.user.findFirst();
  if (!user) {
    user = await prisma.user.create({
      data: {
        email: 'demo@example.com',
        passwordHash: '$2a$10$abcdefghijklmnopqrstuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuu',
        name: 'Demo User',
        role: 'USER'
      }
    });
  }

  // 2. Get or create an organization & project
  let orgUser = await prisma.organizationUser.findFirst({ where: { userId: user.id } });
  let orgId: string;

  if (!orgUser) {
    const org = await prisma.organization.create({
      data: { name: 'Demo Corp' }
    });
    await prisma.organizationUser.create({
      data: { userId: user.id, orgId: org.id, role: 'OWNER' }
    });
    orgId = org.id;
  } else {
    orgId = orgUser.orgId;
  }

  let project = await prisma.project.findFirst({ where: { orgId } });
  if (!project) {
    project = await prisma.project.create({
      data: { orgId, name: 'E-Commerce Platform' }
    });
  }

  // 3. Create Queues
  const emailQueue = await prisma.queue.create({
    data: {
      projectId: project.id,
      name: 'email-notifications',
      priority: 1,
      concurrencyLimit: 5
    }
  });

  const reportQueue = await prisma.queue.create({
    data: {
      projectId: project.id,
      name: 'report-generation',
      priority: 2,
      concurrencyLimit: 2
    }
  });

  console.log(`Created Queues: "${emailQueue.name}" & "${reportQueue.name}"`);

  // 4. Populate Jobs
  // Create 15 Email Queue Jobs
  for (let i = 1; i <= 15; i++) {
    const isFail = i % 4 === 0;
    const isSlow = i % 3 === 0;
    const type = isFail ? 'always-fail' : (isSlow ? 'slow-success' : 'send-welcome-email');
    
    await prisma.job.create({
      data: {
        queueId: emailQueue.id,
        type,
        payload: JSON.stringify({ userId: `user_${i}`, template: 'welcome_v2' }),
        status: 'QUEUED',
        runAt: new Date(Date.now() - Math.random() * 60000)
      }
    });
  }

  // Create 10 Report Queue Jobs
  for (let i = 1; i <= 10; i++) {
    await prisma.job.create({
      data: {
        queueId: reportQueue.id,
        type: 'generate-pdf-invoice',
        payload: JSON.stringify({ invoiceId: `inv_2026_${1000 + i}`, amount: i * 50 }),
        status: 'QUEUED',
        runAt: new Date()
      }
    });
  }

  console.log('✅ Successfully created 25 demo jobs!');
  await prisma.$disconnect();
}

runDemoSeed().catch((err) => {
  console.error(err);
  process.exit(1);
});
