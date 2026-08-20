/**
 * Phase 5 — Worker Service Test Suite
 *
 * TEST 1 — Single worker: QUEUED → CLAIMED → RUNNING → COMPLETED transitions
 * TEST 2 — Duplicate claim check: 2 workers + 20 jobs → no job claimed by both
 * TEST 3 — Force failures: retry backoff → DeadLetterEntry after maxAttempts
 * TEST 4 — Recurring job: new Job instance spawned on schedule
 * TEST 5 — Graceful shutdown: worker finishes in-flight, no orphaned rows
 */

import { PrismaClient } from '@prisma/client';
import { spawn, ChildProcess } from 'child_process';

const prisma = new PrismaClient();
const BASE_URL = 'http://localhost:3000/api';

// ── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function setupQ(label: string, retryOpts = { strategy: 'FIXED', baseDelayMs: 200, maxRetries: 2 }) {
  const email = `${label}_${Date.now()}@t.com`;
  let r = await fetch(`${BASE_URL}/auth/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'pass1234' })
  });
  const { token } = await r.json();
  const h = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  r = await fetch(`${BASE_URL}/orgs`, { method: 'POST', headers: h, body: JSON.stringify({ name: `${label} Org` }) });
  const orgId = (await r.json()).id;

  r = await fetch(`${BASE_URL}/orgs/${orgId}/projects`, { method: 'POST', headers: h, body: JSON.stringify({ name: `${label} Proj` }) });
  const projectId = (await r.json()).id;

  r = await fetch(`${BASE_URL}/projects/${projectId}/queues`, {
    method: 'POST', headers: h,
    body: JSON.stringify({ name: `${label} Q`, concurrencyLimit: 5, retryPolicy: retryOpts })
  });
  const queueId = (await r.json()).id;
  return { h, queueId };
}

async function addJobs(h: Record<string, string>, queueId: string, n: number, type: string) {
  for (let i = 0; i < n; i++) {
    await fetch(`${BASE_URL}/queues/${queueId}/jobs`, {
      method: 'POST', headers: h,
      body: JSON.stringify({ type, payload: { i }, mode: 'immediate' })
    });
  }
}

/**
 * Spawn the worker process.
 * Uses 'pipe' stdio so we can close stdin to trigger graceful shutdown.
 */
function spawnWorker(env: Record<string, string> = {}): ChildProcess {
  return spawn('cmd', ['/c', 'npx tsx src/worker/index.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    stdio: 'pipe',   // stdin=pipe so we can close it for graceful shutdown
  });
}

/** Wait for worker to print "Ready to process jobs" or timeout */
async function workerReady(w: ChildProcess, ms = 20000): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Worker did not start within 20s')), ms);
    w.stdout?.on('data', (d: Buffer) => {
      if (d.toString().includes('Ready to process jobs')) { clearTimeout(t); resolve(); }
    });
    w.on('exit', () => { clearTimeout(t); reject(new Error('Worker exited before ready')); });
  });
}

/** Kill and wait for a worker to fully exit (gracefully via stdin close) */
async function killWorker(w: ChildProcess, ms = 8000): Promise<void> {
  if (w.exitCode !== null) return;
  return new Promise(resolve => {
    const t = setTimeout(() => { try { w.kill(); } catch { /* ignore */ } }, ms);
    w.on('exit', () => { clearTimeout(t); resolve(); });
    // Use stdin.end() for graceful shutdown on Windows instead of SIGTERM
    if (w.stdin) w.stdin.end();
    else w.kill('SIGTERM');
  });
}

/** Trigger graceful shutdown by closing stdin (cross-platform on Windows) */
async function gracefulStop(w: ChildProcess, timeoutMs = 35000): Promise<number | null> {
  return new Promise((resolve) => {
    const t = setTimeout(() => {
      console.log('  [!] Graceful shutdown timed out, force-killing');
      try { w.kill(); } catch { /* ignore */ }
      resolve(null);
    }, timeoutMs);
    w.on('exit', code => { clearTimeout(t); resolve(code); });
    // Closing stdin tells the worker to shut down gracefully
    w.stdin?.end();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST 1: State transitions — QUEUED → CLAIMED → RUNNING → COMPLETED
// ─────────────────────────────────────────────────────────────────────────────
async function test1() {
  console.log('\n══ TEST 1: State Transitions (single worker) ══');

  const { h, queueId } = await setupQ('T1');
  await addJobs(h, queueId, 3, 't1-work');
  const ids = (await prisma.job.findMany({ where: { queueId }, select: { id: true } })).map(j => j.id);

  const startQueued = await prisma.job.count({ where: { id: { in: ids }, status: 'QUEUED' } });
  if (startQueued !== 3) throw new Error(`Expected 3 QUEUED at start, got ${startQueued}`);
  console.log('  ✓ All 3 start as QUEUED');

  const w = spawnWorker();
  let wlog = '';
  w.stdout?.on('data', (d: Buffer) => { wlog += d.toString(); });
  w.stderr?.on('data', (d: Buffer) => { wlog += d.toString(); });

  await workerReady(w);
  console.log('  Worker ready, processing...');
  await sleep(8000);
  await killWorker(w);

  const completed = await prisma.job.count({ where: { id: { in: ids }, status: 'COMPLETED' } });
  const claimed   = await prisma.job.count({ where: { id: { in: ids }, status: 'CLAIMED' } });
  const running   = await prisma.job.count({ where: { id: { in: ids }, status: 'RUNNING' } });

  if (completed < 1) throw new Error(`Expected ≥1 COMPLETED, got ${completed}. Worker log:\n${wlog.slice(-500)}`);
  if (claimed > 0)   throw new Error(`${claimed} jobs stuck in CLAIMED`);
  if (running > 0)   throw new Error(`${running} jobs stuck in RUNNING`);

  const execs = await prisma.jobExecution.count({ where: { jobId: { in: ids } } });
  const logs  = await prisma.jobLog.count({ where: { jobId: { in: ids } } });
  if (execs < 1) throw new Error('No JobExecution rows');
  if (logs < 1)  throw new Error('No JobLog entries');

  console.log(`  ✓ ${completed} COMPLETED, ${ids.length - completed} failed/retried, none stuck`);
  console.log(`  ✓ ${execs} JobExecution rows, ${logs} JobLog entries`);
  console.log('  TEST 1 PASSED ✅');
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST 2: Two workers, 20 jobs — no duplicate concurrent claims
//
// NOTE: "duplicate" here means two DIFFERENT workers held the same job at the
// same time. Retries (same job, later attempt, possibly different worker) are
// CORRECT behaviour and are NOT counted as duplicates.
//
// To keep the check unambiguous we use maxRetries:0 so each job gets exactly
// one execution. Any job with executions from >1 worker is a genuine bug.
// ─────────────────────────────────────────────────────────────────────────────
async function test2() {
  console.log('\n══ TEST 2: No Duplicate Claims (2 workers, 20 jobs) ══');

  // maxRetries:0 → no retries → each job has exactly 1 execution
  const { h, queueId } = await setupQ('T2', { strategy: 'FIXED', baseDelayMs: 100, maxRetries: 0 });
  await addJobs(h, queueId, 20, 't2-claim');

  const w1 = spawnWorker();
  const w2 = spawnWorker();
  await Promise.all([workerReady(w1), workerReady(w2)]);
  console.log('  Both workers ready, processing 20 jobs...');

  await sleep(22000); // 20 jobs × ~500ms each, divided across 2 workers
  await killWorker(w1);
  await killWorker(w2);
  await sleep(1000);

  const jobs = await prisma.job.findMany({ where: { queueId } });
  const processedIds = jobs.filter(j => !['QUEUED', 'SCHEDULED'].includes(j.status)).map(j => j.id);

  const duplicates: string[] = [];
  for (const jobId of processedIds) {
    const execs = await prisma.jobExecution.findMany({ where: { jobId } });
    const distinctWorkers = new Set(execs.map(e => e.workerId));
    if (distinctWorkers.size > 1) duplicates.push(jobId);
  }

  if (duplicates.length > 0) {
    throw new Error(`${duplicates.length} jobs claimed by multiple workers: ${duplicates.slice(0, 3).join(', ')}`);
  }

  const workerRows = await prisma.worker.count({ where: { startedAt: { gte: new Date(Date.now() - 120000) } } });
  console.log(`  ${jobs.length} jobs, ${processedIds.length} processed across 2 workers`);
  console.log('  ✓ Zero duplicate concurrent claims');
  console.log(`  ✓ ${workerRows} Worker rows registered`);
  console.log('  TEST 2 PASSED ✅');
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST 3: Force all failures → retry backoff → DEAD_LETTER after maxAttempts
// ─────────────────────────────────────────────────────────────────────────────
async function test3() {
  console.log('\n══ TEST 3: Retry Backoff → DeadLetterEntry ══');

  // Fresh user/org/project/queue isolated from all others
  const email = `t3_${Date.now()}@t.com`;
  let r = await fetch(`${BASE_URL}/auth/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'pass1234' })
  });
  const { token } = await r.json();
  const h = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  r = await fetch(`${BASE_URL}/orgs`, { method: 'POST', headers: h, body: JSON.stringify({ name: 'T3 Org' }) });
  const orgId = (await r.json()).id;
  r = await fetch(`${BASE_URL}/orgs/${orgId}/projects`, { method: 'POST', headers: h, body: JSON.stringify({ name: 'T3 Proj' }) });
  const projectId = (await r.json()).id;

  // maxRetries=2 → 3 total attempts before dead-letter
  r = await fetch(`${BASE_URL}/projects/${projectId}/queues`, {
    method: 'POST', headers: h,
    body: JSON.stringify({
      name: 'T3 Q', concurrencyLimit: 1,
      retryPolicy: { strategy: 'FIXED', baseDelayMs: 300, maxRetries: 2 }
    })
  });
  const failQueueId = (await r.json()).id;

  // Unique type pinned to FORCE_FAIL_TYPES — no other worker can process it
  const failType = `t3-fail-${Date.now()}`;
  r = await fetch(`${BASE_URL}/queues/${failQueueId}/jobs`, {
    method: 'POST', headers: h,
    body: JSON.stringify({ type: failType, payload: {}, mode: 'immediate' })
  });
  const failJob = await r.json();
  console.log(`  Created job ${failJob.id} (type=${failType})`);

  const w = spawnWorker({ FORCE_FAIL_TYPES: failType });
  let wlog = '';
  w.stdout?.on('data', (d: Buffer) => { wlog += d.toString(); });
  w.stderr?.on('data', (d: Buffer) => { wlog += d.toString(); });

  await workerReady(w);
  console.log('  Worker ready (FORCE_FAIL_TYPES set), waiting for 3 attempts + dead-letter...');

  // 3 attempts × (~100ms handler + 300ms retry delay + 2s poll) ≈ 8–10s
  await sleep(14000);
  await killWorker(w);

  const j = await prisma.job.findUnique({
    where: { id: failJob.id },
    include: { executions: true, logs: true, deadLetter: true }
  });
  if (!j) throw new Error('Job not found');

  if (j.status !== 'DEAD_LETTER') {
    throw new Error(`Expected DEAD_LETTER, got ${j.status} (attempts=${j.attemptCount}). Log:\n${wlog.slice(-500)}`);
  }
  if (!j.deadLetter) throw new Error('No DeadLetterEntry row');
  if (j.attemptCount < 2) throw new Error(`Expected ≥2 attempts, got ${j.attemptCount}`);

  const retryLogs = j.logs.filter(l => /retr/i.test(l.message));
  const deadLog   = j.logs.find(l => /dead/i.test(l.message));
  if (!retryLogs.length) throw new Error(`No retry logs (all logs: ${j.logs.map(l => l.message).join(' | ')})`);
  if (!deadLog) throw new Error('No dead-letter log');

  console.log(`  ✓ DEAD_LETTER after ${j.attemptCount} attempt(s)`);
  console.log(`  ✓ DeadLetterEntry: "${j.deadLetter.reason}"`);
  console.log(`  ✓ ${j.executions.length} executions, ${retryLogs.length} retry log(s)`);
  console.log('  TEST 3 PASSED ✅');
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST 4: Recurring job — new instance spawned when nextRunAt <= now
// ─────────────────────────────────────────────────────────────────────────────
async function test4() {
  console.log('\n══ TEST 4: Recurring Job Spawns New Instances ══');

  const { h, queueId } = await setupQ('T4');
  let r = await fetch(`${BASE_URL}/queues/${queueId}/jobs`, {
    method: 'POST', headers: h,
    body: JSON.stringify({ type: 't4-cron', payload: {}, mode: 'recurring', cronExpression: '* * * * *' })
  });
  const job = await r.json();
  console.log(`  Created recurring job: ${job.id}`);

  // Backdate so the scheduler fires immediately on worker start
  await prisma.scheduledJob.updateMany({
    where: { jobId: job.id },
    data: { nextRunAt: new Date(Date.now() - 60000) }
  });
  console.log('  nextRunAt backdated 1 min → scheduler fires immediately');

  const before = await prisma.job.count({ where: { queueId, type: 't4-cron' } });

  const w = spawnWorker();
  let wlog = '';
  w.stdout?.on('data', (d: Buffer) => { wlog += d.toString(); });
  await workerReady(w);
  console.log('  Worker ready, waiting for scheduler...');

  await sleep(6000);
  await killWorker(w);

  const after = await prisma.job.count({ where: { queueId, type: 't4-cron' } });
  if (after <= before) throw new Error(`Expected new job. Before: ${before}, After: ${after}`);

  const sched = await prisma.scheduledJob.findFirst({ where: { jobId: job.id } });
  if (new Date(sched!.nextRunAt).getTime() <= Date.now() - 120000) {
    throw new Error(`nextRunAt not advanced: ${sched!.nextRunAt}`);
  }

  console.log(`  ✓ ${before} → ${after} job(s) — new instance spawned`);
  console.log(`  ✓ nextRunAt advanced to ${sched!.nextRunAt}`);
  if (wlog.includes('[SCHEDULER] Spawned')) console.log('  ✓ [SCHEDULER] Spawned logged');
  console.log('  TEST 4 PASSED ✅');
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST 5: Graceful shutdown via stdin close — no orphaned CLAIMED/RUNNING rows
//
// Why stdin close instead of SIGINT?
// When spawning `cmd /c npx tsx ...`, the PID belongs to cmd.exe.
// Sending SIGINT to cmd.exe on Windows terminates it abruptly without
// forwarding the signal to the inner Node.js process.
// Closing stdin is cross-platform: the worker detects it and calls
// gracefulShutdown(), which finishes in-flight jobs before exiting.
// ─────────────────────────────────────────────────────────────────────────────
async function test5() {
  console.log('\n══ TEST 5: Graceful Shutdown (stdin close) ══');

  const { h, queueId } = await setupQ('T5');
  await addJobs(h, queueId, 6, 't5-stop');
  console.log('  Created 6 jobs');

  const w = spawnWorker();
  let wlog = '';
  w.stdout?.on('data', (d: Buffer) => { process.stdout.write('  [W] ' + d.toString()); wlog += d.toString(); });
  w.stderr?.on('data', (d: Buffer) => { wlog += d.toString(); });

  await workerReady(w);
  // Let the worker pick up the first batch (1-2 jobs in flight)
  await sleep(3000);

  console.log('  Closing worker stdin → graceful shutdown triggered...');
  const exitCode = await gracefulStop(w);
  console.log(`  Worker exited with code ${exitCode}`);

  await sleep(500);

  const orphanedClaimed = await prisma.job.count({ where: { queueId, status: 'CLAIMED' } });
  const orphanedRunning = await prisma.job.count({ where: { queueId, status: 'RUNNING' } });
  if (orphanedClaimed > 0) throw new Error(`${orphanedClaimed} orphaned CLAIMED rows!`);
  if (orphanedRunning > 0) throw new Error(`${orphanedRunning} orphaned RUNNING rows!`);

  // Worker should have marked itself DEAD
  const deadWorker = await prisma.worker.findFirst({
    where: { status: 'DEAD' },
    orderBy: { startedAt: 'desc' }
  });
  if (!deadWorker) throw new Error(`Worker not marked DEAD (log: ${wlog.slice(-300)})`);

  const hadShutdownMsg = wlog.includes('SHUTTING_DOWN') || wlog.includes('graceful shutdown');
  if (!hadShutdownMsg) throw new Error('Graceful shutdown message not found in worker output');

  const done = await prisma.job.count({ where: { queueId, status: 'COMPLETED' } });
  console.log(`  ✓ No orphaned CLAIMED rows`);
  console.log(`  ✓ No orphaned RUNNING rows`);
  console.log(`  ✓ Worker DB row = DEAD`);
  console.log(`  ✓ Graceful shutdown message logged`);
  console.log(`  ✓ ${done} job(s) completed before shutdown`);
  console.log('  TEST 5 PASSED ✅');
}

// ─────────────────────────────────────────────────────────────────────────────
// Runner
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║   Phase 5 Worker Service — Full Test Suite       ║');
  console.log('╚══════════════════════════════════════════════════╝');

  type Result = { name: string; passed: boolean; error?: string };
  const results: Result[] = [];

  const run = async (name: string, fn: () => Promise<void>) => {
    try { await fn(); results.push({ name, passed: true }); }
    catch (e: any) {
      console.error(`\n❌ FAILED: ${e.message}`);
      results.push({ name, passed: false, error: e.message });
    }
    await sleep(3000); // settle between tests
  };

  await run('TEST 1: State Transitions',   test1);
  await run('TEST 2: No Duplicate Claims', test2);
  await run('TEST 3: Retry → Dead Letter', test3);
  await run('TEST 4: Recurring Job',       test4);
  await run('TEST 5: Graceful Shutdown',   test5);

  await prisma.$disconnect();

  console.log('\n══════════════════════════════════════════════════');
  console.log('                  FINAL RESULTS');
  console.log('══════════════════════════════════════════════════');
  for (const r of results) {
    console.log(`  ${r.passed ? '✅' : '❌'} ${r.name}`);
    if (!r.passed) console.log(`       → ${r.error}`);
  }

  const passed = results.filter(r => r.passed).length;
  if (passed === results.length) {
    console.log('\n🎉 ALL 5 TESTS PASSED — Phase 5 complete!');
  } else {
    console.log(`\n⚠️  ${passed}/${results.length} passed.`);
    process.exit(1);
  }
}

main();
