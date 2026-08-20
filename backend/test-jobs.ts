async function runPhase4Tests() {
  const baseUrl = 'http://localhost:3000/api';

  // ── Setup ──
  const email = `p4_${Date.now()}@test.com`;
  let res = await fetch(`${baseUrl}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'password' })
  });
  const token = (await res.json()).token;
  const h = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  res = await fetch(`${baseUrl}/orgs`, { method: 'POST', headers: h, body: JSON.stringify({ name: 'P4 Org' }) });
  const orgId = (await res.json()).id;
  res = await fetch(`${baseUrl}/orgs/${orgId}/projects`, { method: 'POST', headers: h, body: JSON.stringify({ name: 'P4 Proj' }) });
  const projectId = (await res.json()).id;
  res = await fetch(`${baseUrl}/projects/${projectId}/queues`, {
    method: 'POST', headers: h,
    body: JSON.stringify({ name: 'P4 Queue', retryPolicy: { strategy: 'FIXED', baseDelayMs: 100, maxRetries: 1 } })
  });
  const queueId = (await res.json()).id;
  console.log('Setup complete\n');

  // ══════════════════════════════════════════════════════════
  // TEST 1: Create one job of each of the 5 modes
  // ══════════════════════════════════════════════════════════
  console.log('═══ TEST 1: Create one job of each mode, verify DB fields ═══');

  // 1a. Immediate
  const beforeImmediate = Date.now();
  res = await fetch(`${baseUrl}/queues/${queueId}/jobs`, {
    method: 'POST', headers: h,
    body: JSON.stringify({ type: 'email', payload: { to: 'a@b.com' }, mode: 'immediate' })
  });
  let job = await res.json();
  const runAtImmediate = new Date(job.runAt).getTime();
  if (job.status !== 'QUEUED') throw new Error(`[immediate] Expected QUEUED, got ${job.status}`);
  if (Math.abs(runAtImmediate - beforeImmediate) > 5000) throw new Error('[immediate] runAt not close to now');
  if (job.cronExpression !== null) throw new Error('[immediate] cronExpression should be null');
  console.log('  ✓ immediate: status=QUEUED, runAt≈now, cronExpression=null');

  // 1b. Delayed
  res = await fetch(`${baseUrl}/queues/${queueId}/jobs`, {
    method: 'POST', headers: h,
    body: JSON.stringify({ type: 'report', payload: { id: 1 }, mode: 'delayed', delayMs: 60000 })
  });
  job = await res.json();
  const expectedDelayedRunAt = Date.now() + 60000;
  const actualDelayedRunAt = new Date(job.runAt).getTime();
  if (job.status !== 'SCHEDULED') throw new Error(`[delayed] Expected SCHEDULED, got ${job.status}`);
  if (Math.abs(actualDelayedRunAt - expectedDelayedRunAt) > 5000) throw new Error('[delayed] runAt not ≈ now+60s');
  if (job.cronExpression !== null) throw new Error('[delayed] cronExpression should be null');
  console.log('  ✓ delayed: status=SCHEDULED, runAt≈now+60s, cronExpression=null');

  // 1c. Scheduled
  const scheduledTime = new Date(Date.now() + 7200000).toISOString(); // +2 hours
  res = await fetch(`${baseUrl}/queues/${queueId}/jobs`, {
    method: 'POST', headers: h,
    body: JSON.stringify({ type: 'invoice', payload: { inv: 99 }, mode: 'scheduled', runAt: scheduledTime })
  });
  job = await res.json();
  if (job.status !== 'SCHEDULED') throw new Error(`[scheduled] Expected SCHEDULED, got ${job.status}`);
  const diff = Math.abs(new Date(job.runAt).getTime() - new Date(scheduledTime).getTime());
  if (diff > 1000) throw new Error(`[scheduled] runAt mismatch by ${diff}ms`);
  if (job.cronExpression !== null) throw new Error('[scheduled] cronExpression should be null');
  console.log(`  ✓ scheduled: status=SCHEDULED, runAt matches input, cronExpression=null`);

  // 1d. Recurring
  res = await fetch(`${baseUrl}/queues/${queueId}/jobs`, {
    method: 'POST', headers: h,
    body: JSON.stringify({ type: 'metrics', payload: { src: 'api' }, mode: 'recurring', cronExpression: '0 */6 * * *' })
  });
  job = await res.json();
  const recurringJobId = job.id;
  if (job.status !== 'SCHEDULED') throw new Error(`[recurring] Expected SCHEDULED, got ${job.status}`);
  if (job.cronExpression !== '0 */6 * * *') throw new Error(`[recurring] cronExpression not stored: ${job.cronExpression}`);
  if (!job.runAt) throw new Error('[recurring] runAt should be set to nextRunAt');
  console.log(`  ✓ recurring: status=SCHEDULED, cronExpression="0 */6 * * *", runAt set`);

  // 1e. Batch (just 1 to confirm mode works; full batch test below)
  res = await fetch(`${baseUrl}/queues/${queueId}/jobs`, {
    method: 'POST', headers: h,
    body: JSON.stringify({ type: 'ping', mode: 'batch', jobs: [{ payload: { n: 1 } }] })
  });
  job = await res.json();
  if (job.count !== 1) throw new Error(`[batch] Expected count=1, got ${job.count}`);
  if (!job.batchId) throw new Error('[batch] Missing batchId');
  if (job.jobs[0].status !== 'QUEUED') throw new Error(`[batch] Expected QUEUED`);
  if (job.jobs[0].runAt === null) throw new Error('[batch] runAt should be set');
  console.log('  ✓ batch: status=QUEUED, batchId present, runAt set');

  // ══════════════════════════════════════════════════════════
  // TEST 2: Recurring job creates a ScheduledJob row
  // ══════════════════════════════════════════════════════════
  console.log('\n═══ TEST 2: Recurring job → ScheduledJob row with nextRunAt ═══');
  res = await fetch(`${baseUrl}/jobs/${recurringJobId}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const detail = await res.json();
  if (!detail.scheduledJobs || detail.scheduledJobs.length === 0) throw new Error('No ScheduledJob rows found');
  const sj = detail.scheduledJobs[0];
  if (sj.cronExpression !== '0 */6 * * *') throw new Error(`ScheduledJob cron mismatch: ${sj.cronExpression}`);
  if (!sj.nextRunAt) throw new Error('ScheduledJob.nextRunAt is null');
  if (sj.isActive !== true) throw new Error('ScheduledJob.isActive should be true');
  const nextRun = new Date(sj.nextRunAt).getTime();
  if (nextRun <= Date.now()) throw new Error('nextRunAt should be in the future');
  console.log(`  ✓ ScheduledJob row exists: cron="0 */6 * * *", nextRunAt=${sj.nextRunAt}, isActive=true`);

  // ══════════════════════════════════════════════════════════
  // TEST 3: Batch of 5 payloads → 5 rows, one batchId
  // ══════════════════════════════════════════════════════════
  console.log('\n═══ TEST 3: Batch of 5 payloads → 5 Job rows, shared batchId ═══');
  res = await fetch(`${baseUrl}/queues/${queueId}/jobs`, {
    method: 'POST', headers: h,
    body: JSON.stringify({
      type: 'notify', mode: 'batch',
      jobs: [
        { payload: { userId: 1 } },
        { payload: { userId: 2 } },
        { payload: { userId: 3 } },
        { payload: { userId: 4 } },
        { payload: { userId: 5 } }
      ]
    })
  });
  const batch = await res.json();
  if (batch.count !== 5) throw new Error(`Expected 5 jobs, got ${batch.count}`);
  const batchIds = new Set(batch.jobs.map((j: any) => j.batchId));
  if (batchIds.size !== 1) throw new Error(`Expected 1 unique batchId, got ${batchIds.size}`);
  const payloads = batch.jobs.map((j: any) => JSON.parse(j.payload).userId).sort();
  if (JSON.stringify(payloads) !== '[1,2,3,4,5]') throw new Error(`Payloads mismatch: ${JSON.stringify(payloads)}`);
  console.log(`  ✓ 5 jobs created, all share batchId="${batch.batchId}"`);
  console.log(`  ✓ Payloads verified: userIds [1,2,3,4,5]`);

  // ══════════════════════════════════════════════════════════
  // TEST 4: Filtering + pagination
  // ══════════════════════════════════════════════════════════
  console.log('\n═══ TEST 4: Filtering and pagination ═══');

  // 4a. Filter by status=QUEUED
  res = await fetch(`${baseUrl}/queues/${queueId}/jobs?status=QUEUED`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  let list = await res.json();
  const allQueued = list.data.every((j: any) => j.status === 'QUEUED');
  if (!allQueued) throw new Error('Status filter leaked non-QUEUED jobs');
  console.log(`  ✓ status=QUEUED filter: ${list.meta.total} results, all QUEUED`);

  // 4b. Filter by status=SCHEDULED
  res = await fetch(`${baseUrl}/queues/${queueId}/jobs?status=SCHEDULED`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  list = await res.json();
  const allScheduled = list.data.every((j: any) => j.status === 'SCHEDULED');
  if (!allScheduled) throw new Error('Status filter leaked non-SCHEDULED jobs');
  console.log(`  ✓ status=SCHEDULED filter: ${list.meta.total} results, all SCHEDULED`);

  // 4c. Filter by type
  res = await fetch(`${baseUrl}/queues/${queueId}/jobs?type=notify`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  list = await res.json();
  const allNotify = list.data.every((j: any) => j.type === 'notify');
  if (!allNotify) throw new Error('Type filter leaked non-notify jobs');
  console.log(`  ✓ type=notify filter: ${list.meta.total} results, all type=notify`);

  // 4d. Pagination: page=1, limit=3
  res = await fetch(`${baseUrl}/queues/${queueId}/jobs?page=1&limit=3`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  list = await res.json();
  if (list.data.length !== 3) throw new Error(`Expected 3 items on page, got ${list.data.length}`);
  if (list.meta.page !== 1) throw new Error(`Expected page=1`);
  if (list.meta.limit !== 3) throw new Error(`Expected limit=3`);
  if (list.meta.totalPages < 2) throw new Error(`Expected totalPages >= 2 with limit=3`);
  console.log(`  ✓ Pagination: page=1, limit=3, returned ${list.data.length} items, total=${list.meta.total}, totalPages=${list.meta.totalPages}`);

  // 4e. Pagination: page=2
  res = await fetch(`${baseUrl}/queues/${queueId}/jobs?page=2&limit=3`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  list = await res.json();
  if (list.data.length === 0 && list.meta.total > 3) throw new Error('Page 2 should have items');
  if (list.meta.page !== 2) throw new Error(`Expected page=2`);
  console.log(`  ✓ Pagination: page=2, limit=3, returned ${list.data.length} items`);

  // ══════════════════════════════════════════════════════════
  // TEST 5: Invalid cron string rejected
  // ══════════════════════════════════════════════════════════
  console.log('\n═══ TEST 5: Invalid cron string rejected with clear error ═══');
  res = await fetch(`${baseUrl}/queues/${queueId}/jobs`, {
    method: 'POST', headers: h,
    body: JSON.stringify({ type: 'x', payload: {}, mode: 'recurring', cronExpression: 'INVALID_CRON' })
  });
  const errBody = await res.json();
  if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
  if (errBody.error.code !== 'VALIDATION_ERROR') throw new Error(`Expected VALIDATION_ERROR code`);
  const cronIssue = errBody.error.details.find((d: any) => d.path?.includes('cronExpression'));
  if (!cronIssue) throw new Error('Error details should mention cronExpression');
  console.log(`  ✓ Rejected with 400 VALIDATION_ERROR`);
  console.log(`  ✓ Error detail: "${cronIssue.message}"`);

  // Also test empty cron
  res = await fetch(`${baseUrl}/queues/${queueId}/jobs`, {
    method: 'POST', headers: h,
    body: JSON.stringify({ type: 'x', payload: {}, mode: 'recurring', cronExpression: '' })
  });
  if (res.status !== 400) throw new Error(`Expected 400 for empty cron, got ${res.status}`);
  console.log('  ✓ Empty cron also rejected with 400');

  console.log('\n🎉 ALL PHASE 4 TESTS PASSED!\n');
}

runPhase4Tests().catch(e => {
  console.error('\n❌ Test failed:', e);
  process.exit(1);
});
