import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiClient, ApiError, errorText } from '../src/api.js';
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
test('login uses form, cookie jar, server CSRF name and rotated token', async () => {
  const calls = [], replies = [json({ headerName: 'X-Test-CSRF', token: 'before' }), json({ id: 'owner' }), json({ headerName: 'X-Test-CSRF', token: 'after' }), json({ id: 'owner' }), new Response(null, { status: 204 }), json({ headerName: 'X-Test-CSRF', token: 'out' })];
  const api = new ApiClient({ fetchImpl: async (path, options) => { calls.push({ path, ...options }); return replies.shift(); } });
  assert.equal((await api.login('owner@example.test', 'test-only-password')).id, 'owner');
  assert.equal(calls[1].path, '/api/v1/auth/login');
  assert.equal(calls[1].headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.equal(calls[1].headers['X-Test-CSRF'], 'before');
  assert.equal(new URLSearchParams(calls[1].body).get('email'), 'owner@example.test');
  await api.logout(); assert.equal(calls[4].headers['X-Test-CSRF'], 'after'); assert.equal(calls[4].body, undefined);
  assert.ok(calls.every(call => call.credentials === 'include'));
  assert.ok(calls.filter(call => call.method === 'GET').every(call => !call.headers['X-Test-CSRF']));
});
test('password error, session expiry, 403 and 503 remain distinct; no write retry', async () => {
  for (const [status, code] of [[401, 'INVALID_CREDENTIALS'], [403, 'ACCESS_DENIED'], [503, 'AUTH_UNAVAILABLE']]) {
    let expired = 0, requests = 0;
    const api = new ApiClient({ fetchImpl: async () => { requests++; return json({ code }, status); }, onUnauthorized: () => expired++ });
    api.csrf = { headerName: 'X-CSRF', token: 'fixture' };
    await assert.rejects(api.request('/auth/login', { method: 'POST', form: { email: 'fixture', password: 'fixture' } }), e => e instanceof ApiError && e.status === status && e.code === code);
    assert.equal(requests, 1); assert.equal(expired, 0); assert.notEqual(errorText(new ApiError(status, code)), '');
  }
  let expired = 0;
  const api = new ApiClient({ fetchImpl: async () => json({ code: 'UNAUTHENTICATED' }, 401), onUnauthorized: () => expired++ });
  await assert.rejects(api.request('/auth/me')); assert.equal(expired, 1); assert.equal(api.csrf, null);
});
test('network, timeout and invalid API response have explicit errors', async () => {
  await assert.rejects(new ApiClient({ fetchImpl: async () => { throw new TypeError('network'); } }).request('/auth/me'), e => e.code === 'NETWORK_ERROR');
  const slow = new ApiClient({ timeoutMs: 5, fetchImpl: (_path, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('timeout', 'AbortError')))) });
  await assert.rejects(slow.request('/auth/me'), e => e.code === 'REQUEST_TIMEOUT');
  await assert.rejects(new ApiClient({ fetchImpl: async () => new Response('<html>proxy error</html>') }).request('/auth/me'), e => e.code === 'INVALID_RESPONSE');
});
test('API client refuses external origins before attaching cookies or CSRF', async () => {
  const api = new ApiClient({ fetchImpl: () => assert.fail('must not fetch') });
  await assert.rejects(api.request('//s3.example.test/object')); await assert.rejects(api.request('https://s3.example.test/object'));
});
test('anonymous startup is silent but later protected 401 notifies session expiry', async () => {
  let expired = 0;
  const api = new ApiClient({ fetchImpl: async () => json({ code: 'UNAUTHENTICATED' }, 401), onUnauthorized: () => expired++ });
  await assert.rejects(api.request('/auth/me', { notifyUnauthorized: false })); assert.equal(expired, 0);
  await assert.rejects(api.request('/projects')); assert.equal(expired, 1);
});

test('concurrent first mutations share one CSRF bootstrap and cannot split the anonymous cookie session', async () => {
  let bootstraps = 0, cookieSession = 0, writes = 0;
  const api = new ApiClient({ fetchImpl: async (path, options) => {
    if (path.endsWith('/csrf')) {
      const session = ++bootstraps; cookieSession = session;
      return { ok: true, status: 200, json: async () => { await new Promise(resolve => setTimeout(resolve, 10)); return { headerName: 'X-CSRF', token: String(session) }; } };
    }
    writes++;
    return options.headers['X-CSRF'] === String(cookieSession) ? json({ id: 'project' }) : json({ code: 'ACCESS_DENIED' }, 403);
  } });
  const results = await Promise.allSettled([api.request('/projects', { method: 'POST', body: { name: 'one' } }), api.request('/projects', { method: 'POST', body: { name: 'two' } })]);
  assert.equal(bootstraps, 1); assert.equal(writes, 2);
  assert.ok(results.every(result => result.status === 'fulfilled'));
});

test('a late 401 from the previous session cannot invalidate a newly logged-in account', async () => {
  let finishOld, expired = 0, loggedIn = false;
  const api = new ApiClient({ onUnauthorized: () => expired++, fetchImpl: async path => {
    if (path.endsWith('/projects')) return new Promise(resolve => { finishOld = resolve; });
    if (path.endsWith('/csrf')) return json({ headerName: 'X-CSRF', token: loggedIn ? 'new-session' : 'old-session' });
    if (path.endsWith('/login')) { loggedIn = true; return json({ id: 'new-account' }); }
    return json({ id: 'new-account' });
  } });
  const old = api.request('/projects');
  await api.login('new@example.test', 'fixture-only');
  finishOld(json({ code: 'UNAUTHENTICATED' }, 401));
  await assert.rejects(old, error => error.status === 401);
  assert.equal(expired, 0); assert.equal(api.csrf.token, 'new-session');
});
