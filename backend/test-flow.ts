async function runTests() {
  const baseUrl = 'http://localhost:3000/api';
  let token1 = '';
  let token2 = '';
  let orgId = '';
  let projectId = '';

  const email1 = `u1_${Date.now()}@test.com`;
  const email2 = `u2_${Date.now()}@test.com`;

  console.log('1. Signup U1');
  let res = await fetch(`${baseUrl}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email1, password: 'password', name: 'User 1' })
  });
  let data = await res.json();
  if (!data.token) throw new Error('No token returned on signup');
  
  console.log('2. Login U1');
  res = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email1, password: 'password' })
  });
  data = await res.json();
  if (!data.token) throw new Error('No token returned on login');
  token1 = data.token;
  console.log('Login successful');

  console.log('3. Hitting a protected route without a token returns 401');
  res = await fetch(`${baseUrl}/auth/me`);
  if (res.status !== 401) throw new Error(`Expected 401, got ${res.status}`);
  console.log('Successfully blocked (401)');

  console.log('4. Create org -> create project under it -> both show up on GET');
  res = await fetch(`${baseUrl}/orgs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token1}` },
    body: JSON.stringify({ name: 'My Test Org' })
  });
  data = await res.json();
  orgId = data.id;
  
  res = await fetch(`${baseUrl}/orgs/${orgId}/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token1}` },
    body: JSON.stringify({ name: 'My Test Project' })
  });
  data = await res.json();
  projectId = data.id;

  // GET orgs
  res = await fetch(`${baseUrl}/orgs`, {
    headers: { Authorization: `Bearer ${token1}` }
  });
  data = await res.json();
  if (!data.find((o: any) => o.id === orgId)) throw new Error('Org missing');

  // GET projects
  res = await fetch(`${baseUrl}/orgs/${orgId}/projects`, {
    headers: { Authorization: `Bearer ${token1}` }
  });
  data = await res.json();
  if (!data.find((p: any) => p.id === projectId)) throw new Error('Project missing');
  console.log('Org and Project creation and listing successful');

  console.log('5. Try accessing another user\'s org/project -> get 403 (not leaked)');
  // Signup U2
  res = await fetch(`${baseUrl}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email2, password: 'password', name: 'User 2' })
  });
  data = await res.json();
  token2 = data.token;

  // Try accessing U1 org
  res = await fetch(`${baseUrl}/orgs/${orgId}/projects`, {
    headers: { Authorization: `Bearer ${token2}` }
  });
  if (res.status !== 403) throw new Error(`Expected 403 for org access, got ${res.status}`);

  // Try accessing U1 project
  res = await fetch(`${baseUrl}/projects/${projectId}`, {
    headers: { Authorization: `Bearer ${token2}` }
  });
  if (res.status !== 403) throw new Error(`Expected 403 for project access, got ${res.status}`);
  console.log('Successfully blocked cross-user access (403)');

  console.log('All tests passed! ✅');
}

runTests().catch(e => {
  console.error('Test failed:', e.message);
  process.exit(1);
});
