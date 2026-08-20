/**
 * handler.ts
 * 
 * ╔═══════════════════════════════════════════════════════════════════╗
 * ║  PLUGGABLE JOB HANDLER — REPLACE THIS WITH YOUR REAL LOGIC      ║
 * ║                                                                   ║
 * ║  This mock handler simulates work with a random delay (200–800ms) ║
 * ║  and randomly succeeds (~70%) or fails (~30%).                    ║
 * ║                                                                   ║
 * ║  To plug in real handlers, replace the `executeJob` function or   ║
 * ║  build a registry that maps `job.type` → handler function.        ║
 * ╚═══════════════════════════════════════════════════════════════════╝
 */

export interface JobPayload {
  id: string;
  type: string;
  payload: string;
  queueId: string;
}

export interface JobResult {
  success: boolean;
  error?: string;
  output?: string;
}

/**
 * Execute a job. This is the function workers call for every claimed job.
 * 
 * REPLACE THIS with real logic — e.g., sending emails, generating reports,
 * calling external APIs, etc. You can use `job.type` to dispatch to
 * different handler functions.
 */
export async function executeJob(job: JobPayload): Promise<JobResult> {
  // TEST HOOKS: Deterministic behavior based on job type
  if (job.type === 'always-fail') {
    return { success: false, error: 'Forced failure' };
  }
  if (job.type === 'sync-error') {
    throw new Error('Synchronous error thrown');
  }
  if (job.type === 'async-reject') {
    await new Promise(resolve => setTimeout(resolve, 50));
    throw new Error('Async promise rejected');
  }
  if (job.type === 'hang-forever') {
    await new Promise(() => {}); // never resolves
  }
  if (job.type === 'slow-success') {
    await new Promise(resolve => setTimeout(resolve, 1500));
    return { success: true, output: 'Slow job complete' };
  }

  // Default fast success for generic test jobs
  await new Promise(resolve => setTimeout(resolve, 50));
  return { success: true, output: 'Job completed successfully' };
}
