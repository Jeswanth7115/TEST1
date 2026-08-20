/**
 * End-to-end test for the Worker Service.
 * 
 * 1. Create auth + org + project + queue
 * 2. Seed jobs of different types
 * 3. Start the worker process
 * 4. Wait for it to process jobs
 * 5. Verify state transitions in the DB
 */

async function setupAndSeedJobs(): Promise<{ token: string; queueId: string }> {
  const baseUrl = 'http://localhost:3000/api';
  const email = `wtest_${Date.now()}@test.com`;
  
  let res = await fetch(`${baseUrl}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'password' })
  });
  const token = (await res.json()).token;
  const h = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  res = await fetch(`${baseUrl}/orgs`, { method: 'POST', headers: h, body: JSON.stringify({ name: 'Worker Test Org' }) });
  const orgId = (await res.json()).id;

  res = await fetch(`${baseUrl}/orgs/${orgId}/projects`, { method: 'POST', headers: h, body: JSON.stringify({ name: 'Worker Test Proj' }) });
  const projectId = (await res.json()).id;

  // Queue with retryPolicy: EXPONENTIAL, 3 retries
  res = await fetch(`${baseUrl}/projects/${projectId}/queues`, {
    method: 'POST', headers: h,
    body: JSON.stringify({
      name: 'Worker Test Queue',
      concurrencyLimit: 5,
      retryPolicy: { strategy: 'EXPONENTIAL', baseDelayMs: 100, maxRetries: 3 }
    })
  });
  const queueId = (await res.json()).id;

  // Create 6 immediate jobs (some will succeed, some fail due to 70% mock rate)
  for (let i = 0; i < 6; i++) {
    await fetch(`${baseUrl}/queues/${queueId}/jobs`, {
      method: 'POST', headers: h,
      body: JSON.stringify({ type: `task-${i}`, payload: { index: i }, mode: 'immediate' })
    });
  }

  console.log('✓ Seeded 6 immediate jobs into the queue');
  return { token, queueId };
}

async function checkResults(token: string, queueId: string): Promise<void> {
  const baseUrl = 'http://localhost:3000/api';

  // Check the queue stats
  let res = await fetch(`${baseUrl}/queues/${queueId}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const queue = await res.json();

  console.log('\n═══ Queue Stats After Worker Processing ═══');
  console.log(JSON.stringify(queue.stats, null, 2));

  const totalProcessed = queue.stats.COMPLETED + queue.stats.FAILED + queue.stats.DEAD_LETTER;
  const stillPending = queue.stats.QUEUED + queue.stats.RUNNING + queue.stats.CLAIMED;

  if (queue.stats.COMPLETED > 0) {
    console.log(`✓ ${queue.stats.COMPLETED} job(s) COMPLETED`);
  }
  if (queue.stats.FAILED > 0) {
    console.log(`✓ ${queue.stats.FAILED} job(s) FAILED (will be retried)`);
  }
  if (queue.stats.DEAD_LETTER > 0) {
    console.log(`✓ ${queue.stats.DEAD_LETTER} job(s) DEAD_LETTERED (exhausted retries)`);
  }

  // Check that at least some jobs moved from QUEUED
  if (totalProcessed === 0 && stillPending === 6) {
    throw new Error('No jobs were processed! Worker may not have claimed anything.');
  }

  // Check for JobExecution rows
  res = await fetch(`${baseUrl}/queues/${queueId}/jobs?limit=50`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const jobs = await res.json();

  // Pick a completed or failed job and check its executions
  const processedJob = jobs.data.find((j: any) => j.status === 'COMPLETED' || j.status === 'FAILED' || j.status === 'DEAD_LETTER');
  if (processedJob) {
    res = await fetch(`${baseUrl}/jobs/${processedJob.id}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const detail = await res.json();
    console.log(`\n═══ Sample Job Detail (${detail.status}) ═══`);
    console.log(`  Executions: ${detail.executions.length}`);
    console.log(`  Logs: ${detail.logs.length}`);

    if (detail.executions.length === 0) {
      throw new Error('Processed job has no JobExecution rows!');
    }
    if (detail.logs.length === 0) {
      throw new Error('Processed job has no JobLog entries!');
    }

    console.log('  ✓ JobExecution rows present');
    console.log('  ✓ JobLog entries present');

    // Check execution has proper fields
    const exec = detail.executions[0];
    if (!exec.workerId) throw new Error('Execution missing workerId');
    if (!exec.startedAt) throw new Error('Execution missing startedAt');
    console.log(`  ✓ Execution has workerId=${exec.workerId}, status=${exec.status}`);
  }

  console.log('\n🎉 Worker Service E2E Test PASSED!');
}

async function main() {
  console.log('═══ Phase 5 Worker E2E Test ═══\n');

  const { token, queueId } = await setupAndSeedJobs();

  console.log('Waiting 8 seconds for worker to process jobs...');
  console.log('(Start the worker in another terminal: npm run worker:start)\n');

  // Give the worker time to poll, claim, and execute
  await new Promise(r => setTimeout(r, 8000));

  await checkResults(token, queueId);
}

main().catch(e => {
  console.error('Test failed:', e);
  process.exit(1);
});
