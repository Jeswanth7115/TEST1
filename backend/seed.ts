import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('Starting seed...')
  
  const rp = await prisma.retryPolicy.create({
    data: { strategy: 'FIXED', baseDelayMs: 1000, maxRetries: 3 }
  })

  const u = await prisma.user.create({
    data: { email: 'test_' + Date.now() + '@test.com', passwordHash: 'hash', role: 'ADMIN', name: 'Test' }
  })

  const o = await prisma.organization.create({
    data: { name: 'Acme Corp' }
  })

  await prisma.organizationUser.create({
    data: { userId: u.id, orgId: o.id, role: 'OWNER' }
  })

  const p = await prisma.project.create({
    data: { name: 'Proj 1', orgId: o.id }
  })

  const q = await prisma.queue.create({
    data: { name: 'Queue 1', projectId: p.id, defaultRetryPolicyId: rp.id }
  })

  const j = await prisma.job.create({
    data: { queueId: q.id, type: 'email', payload: '{}', status: 'QUEUED' }
  })

  const w = await prisma.worker.create({
    data: { hostname: 'worker-1', status: 'ACTIVE', lastSeenAt: new Date() }
  })

  const je = await prisma.jobExecution.create({
    data: { jobId: j.id, workerId: w.id, status: 'RUNNING' }
  })

  await prisma.workerHeartbeat.create({
    data: { workerId: w.id, activeJobCount: 1 }
  })

  await prisma.jobLog.create({
    data: { jobId: j.id, executionId: je.id, level: 'INFO', message: 'Started' }
  })

  const j2 = await prisma.job.create({
    data: { queueId: q.id, type: 'email', payload: '{}', status: 'SCHEDULED' }
  })

  await prisma.scheduledJob.create({
    data: { jobId: j2.id, cronExpression: '* * * * *', nextRunAt: new Date() }
  })

  const j3 = await prisma.job.create({
    data: { queueId: q.id, type: 'email', payload: '{}', status: 'DEAD_LETTER' }
  })

  await prisma.deadLetterEntry.create({
    data: { jobId: j3.id, reason: 'failed', originalPayload: '{}' }
  })

  console.log('Seeded all tables successfully without FK errors!')
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect())
