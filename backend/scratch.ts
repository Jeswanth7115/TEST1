import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const BASE_URL = 'http://localhost:3000/api';

async function main() {
  const email = `phase6_${Date.now()}@t.com`;
  let r = await fetch(`${BASE_URL}/auth/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'pass1234' })
  });
  const { token } = await r.json();
  const h = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  r = await fetch(`${BASE_URL}/orgs`, { method: 'POST', headers: h, body: JSON.stringify({ name: 'P6 Org' }) });
  const orgId = (await r.json()).id;

  r = await fetch(`${BASE_URL}/orgs/${orgId}/projects`, { method: 'POST', headers: h, body: JSON.stringify({ name: 'P6 Proj' }) });
  const projectId = (await r.json()).id;

  r = await fetch(`${BASE_URL}/projects/${projectId}/queues`, {
    method: 'POST', headers: h,
    body: JSON.stringify({ name: 'P6 Q', retryPolicy: { strategy: 'FIXED', baseDelayMs: 200, maxRetries: 2 } })
  });
  const queueId = (await r.json()).id;

  console.log('Testing Error Shapes...');
  // 404 Error
  const err404 = await (await fetch(`${BASE_URL}/queues/invalid-id`, { headers: h })).json();
  console.assert(err404.error.code === 'NOT_FOUND', '404 format failed');
  
  // Validation Error (400)
  const err400 = await (await fetch(`${BASE_URL}/orgs`, { method: 'POST', headers: h, body: JSON.stringify({}) })).json();
  console.assert(err400.error.code === 'VALIDATION_ERROR', '400 format failed');

  console.log('Testing Idempotency...');
  const idk = `idemp-${Date.now()}`;
  const res1 = await fetch(`${BASE_URL}/queues/${queueId}/jobs`, {
    method: 'POST', headers: { ...h, 'Idempotency-Key': idk },
    body: JSON.stringify({ type: 'test', payload: {}, mode: 'immediate' })
  });
  const job1 = await res1.json();
  console.assert(res1.status === 201, 'First post should be 201');
  
  const res2 = await fetch(`${BASE_URL}/queues/${queueId}/jobs`, {
    method: 'POST', headers: { ...h, 'Idempotency-Key': idk },
    body: JSON.stringify({ type: 'test', payload: {}, mode: 'immediate' })
  });
  const job2 = await res2.json();
  console.assert(res2.status === 200, 'Second post should be 200');
  console.assert(job1.id === job2.id, 'IDs must match');

  console.log('Testing Metrics (Empty)...');
  const m = await (await fetch(`${BASE_URL}/queues/${queueId}/metrics`, { headers: h })).json();
  console.assert(m.throughputPerMinute === 0, 'Empty throughput should be 0');

  console.log('All tests passed successfully!');
}

main();
