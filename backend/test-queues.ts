async function runQueueTests() {
  const baseUrl = 'http://localhost:3000/api';
  
  // 1. Setup Auth and Org/Project
  const email = `qtest_${Date.now()}@test.com`;
  let res = await fetch(`${baseUrl}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'password' })
  });
  let data = await res.json();
  const token = data.token;

  res = await fetch(`${baseUrl}/orgs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name: 'Queue Test Org' })
  });
  const orgId = (await res.json()).id;

  res = await fetch(`${baseUrl}/orgs/${orgId}/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name: 'Queue Test Project' })
  });
  const projectId = (await res.json()).id;

  // 2. Create Queue & verify retry policy
  console.log('--- Creating Queue with Retry Policy');
  res = await fetch(`${baseUrl}/projects/${projectId}/queues`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      name: 'Test Queue',
      priority: 5,
      concurrencyLimit: 2,
      retryPolicy: { strategy: 'LINEAR', baseDelayMs: 2000, maxRetries: 3 }
    })
  });
  let queue = await res.json();
  if (res.status !== 201) throw new Error(`Queue creation failed: ${JSON.stringify(queue)}`);
  if (!queue.retryPolicy || queue.retryPolicy.strategy !== 'LINEAR') {
    throw new Error('Retry policy not properly attached or returned');
  }
  const queueId = queue.id;
  console.log('Queue created successfully with Retry Policy attached!');

  // 3. Pause & Resume Queue
  console.log('--- Pausing Queue');
  res = await fetch(`${baseUrl}/queues/${queueId}/pause`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }
  });
  queue = await res.json();
  if (queue.isPaused !== true) throw new Error('Queue failed to pause');
  console.log('Queue isPaused flipped to true!');

  console.log('--- Resuming Queue');
  res = await fetch(`${baseUrl}/queues/${queueId}/resume`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }
  });
  queue = await res.json();
  if (queue.isPaused !== false) throw new Error('Queue failed to resume');
  console.log('Queue isPaused flipped back to false!');

  // 4. Stats endpoint (zero counts)
  console.log('--- Checking Queue Live Stats');
  res = await fetch(`${baseUrl}/queues/${queueId}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  queue = await res.json();
  if (queue.stats.QUEUED !== 0 || queue.stats.COMPLETED !== 0) {
    throw new Error(`Queue stats not zeroed: ${JSON.stringify(queue.stats)}`);
  }
  console.log('Queue stats correctly returned all zeroes for empty queue:', queue.stats);

  // 5. Pagination
  console.log('--- Testing Pagination');
  // Create another queue
  await fetch(`${baseUrl}/projects/${projectId}/queues`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      name: 'Test Queue 2',
      retryPolicy: { strategy: 'FIXED', baseDelayMs: 100, maxRetries: 1 }
    })
  });

  res = await fetch(`${baseUrl}/projects/${projectId}/queues?page=1&limit=1`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  data = await res.json();
  if (data.data.length !== 1 || data.meta.total !== 2 || data.meta.totalPages !== 2) {
    throw new Error(`Pagination metadata incorrect: ${JSON.stringify(data.meta)}`);
  }
  console.log('Pagination returned correct page(1), limit(1), total(2), totalPages(2)!');

  console.log('✅ All Queue tests passed successfully!');
}

runQueueTests().catch(e => {
  console.error('Test failed:', e);
  process.exit(1);
});
