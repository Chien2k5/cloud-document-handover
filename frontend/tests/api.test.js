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


const registrationInput = { displayName: '  Fixture Name  ', email: '  PERSON@Example.TEST  ', password: '  CaseSensitiveFixture#  ', confirmPassword: '  CaseSensitiveFixture#  ' };
const registeredUser = { id: '10000000-0000-0000-0000-000000000005', email: 'person@example.test', displayName: 'Fixture Name' };
test('register bootstraps dynamic CSRF and posts exactly four original JSON fields on the internal cookie path', async () => {
  const calls = [];
  const api = new ApiClient({ fetchImpl: async (path, options) => {
    calls.push({ path, ...options });
    return path.endsWith('/csrf') ? json({ headerName: 'X-Registration-CSRF', token: 'masked' }) : json(registeredUser, 201);
  } });
  assert.deepEqual(await api.register({ ...registrationInput, role: 'OWNER', destination: 'https://external.example.test' }), registeredUser);
  assert.deepEqual(calls.map(c => [c.method, c.path]), [['GET', '/api/v1/auth/csrf'], ['POST', '/api/v1/auth/register']]);
  assert.equal(calls[1].headers['Content-Type'], 'application/json'); assert.equal(calls[1].headers.Accept, 'application/json');
  assert.equal(calls[1].headers['X-Registration-CSRF'], 'masked'); assert.equal(calls[1].headers['X-CSRF-TOKEN'], undefined);
  assert.deepEqual(JSON.parse(calls[1].body), registrationInput); assert.ok(calls.every(c => c.credentials === 'include'));
  assert.equal(calls[0].body, undefined); assert.ok(!JSON.stringify(calls[0]).includes(registrationInput.password));
  assert.equal(api.authEpoch, 0); assert.equal(api.csrf.token, 'masked');
});
test('register reuses an authenticated CSRF session without login/logout/me or invalidation', async () => {
  let requests = 0, expired = 0;
  const api = new ApiClient({ onUnauthorized: () => expired++, fetchImpl: async (path, options) => {
    requests++; assert.equal(path, '/api/v1/auth/register'); assert.equal(options.headers['X-Existing-CSRF'], 'existing'); return json(registeredUser, 201);
  } });
  const csrf = { headerName: 'X-Existing-CSRF', token: 'existing' }; api.csrf = csrf;
  await api.register(registrationInput); assert.equal(requests, 1); assert.equal(expired, 0); assert.equal(api.csrf, csrf); assert.equal(api.authEpoch, 0);
});
for (const [status, code, message] of [
  [400, 'VALIDATION_ERROR', 'Thông tin đăng ký không hợp lệ. Vui lòng kiểm tra lại.'],
  [409, 'EMAIL_ALREADY_EXISTS', 'Email này đã được sử dụng. Vui lòng dùng email khác hoặc đăng nhập.'],
  [403, 'ACCESS_DENIED', 'Không đủ quyền hoặc CSRF đã hết hạn.'],
  [415, 'UNSUPPORTED_MEDIA_TYPE', 'Không thực hiện được thao tác.'], [406, 'NOT_ACCEPTABLE', 'Không thực hiện được thao tác.'],
  [500, 'INTERNAL_ERROR', 'Dịch vụ tạm thời không sẵn sàng.'], [503, 'AUTH_UNAVAILABLE', 'Dịch vụ xác thực tạm thời không sẵn sàng.'],
  [401, 'UNAUTHENTICATED', 'Phiên đăng nhập đã hết.'],
]) test(`register ${status} ${code} retains session, normalizes errors and never retries or leaks internals`, async () => {
  let requests = 0, expired = 0;
  const api = new ApiClient({ onUnauthorized: () => expired++, fetchImpl: async () => {
    requests++; return json({ code, requestId: 'registration-request-fixture', message: registrationInput.password + ' private SQL', passwordHash: 'private-hash' }, status);
  } });
  const csrf = { headerName: 'X-CSRF', token: 'existing' }; api.csrf = csrf;
  await assert.rejects(api.register(registrationInput), e => {
    assert.ok(e instanceof ApiError); assert.equal(e.status, status); assert.equal(e.code, code); assert.equal(e.operation, 'register');
    assert.ok(errorText(e).startsWith(message)); assert.ok(errorText(e).includes('registration-request-fixture'));
    for (const text of [String(e), JSON.stringify(e), errorText(e)]) for (const secret of [registrationInput.password, 'private SQL', 'private-hash']) assert.ok(!text.includes(secret));
    return true;
  });
  assert.equal(requests, 1); assert.equal(expired, 0); assert.equal(api.csrf, csrf); assert.equal(api.authEpoch, 0);
});
test('registration mapping preserves unrelated validation and existing authentication messages', () => {
  assert.equal(errorText(new ApiError(400, 'VALIDATION_ERROR')), 'Dữ liệu không hợp lệ. Kiểm tra các trường bắt buộc.');
  assert.equal(errorText(new ApiError(401, 'INVALID_CREDENTIALS')), 'Email hoặc mật khẩu không đúng.');
  assert.equal(errorText(new ApiError(401, 'ACCOUNT_DISABLED')), 'Tài khoản đã bị vô hiệu hóa.');
  assert.equal(errorText(new ApiError(503, 'AUTH_UNAVAILABLE')), 'Dịch vụ xác thực tạm thời không sẵn sàng.');
});
for (const [name, response] of [
  ['200', () => json(registeredUser)], ['202', () => json(registeredUser, 202)], ['204', () => new Response(null, { status: 204 })],
  ['non-JSON', () => new Response('<html>private failure</html>', { status: 201 })], ['null', () => json(null, 201)], ['array', () => json([registeredUser], 201)],
  ['missing field', () => json({ id: registeredUser.id, email: registeredUser.email }, 201)], ['wrong type', () => json({ ...registeredUser, displayName: 123 }, 201)],
  ['blank field', () => json({ ...registeredUser, email: ' ' }, 201)], ['invalid UUID', () => json({ ...registeredUser, id: 'invalid' }, 201)],
  ['extra secret', () => json({ ...registeredUser, passwordHash: 'private-hash' }, 201)],
]) test(`register rejects unconfirmed success: ${name}`, async () => {
  let calls = 0;
  const api = new ApiClient({ fetchImpl: async () => { calls++; return response(); } }); api.csrf = { headerName: 'X-CSRF', token: 'existing' };
  await assert.rejects(api.register(registrationInput), e => e.code === 'INVALID_RESPONSE' && e.operation === 'register' && errorText(e).includes('Hãy thử đăng nhập trước khi gửi đăng ký lại.'));
  assert.equal(calls, 1);
});
for (const kind of ['network', 'timeout']) test(`register ${kind} is uncertain and never retried`, async () => {
  let calls = 0;
  const api = new ApiClient({ timeoutMs: 5, fetchImpl: async (_path, options) => {
    calls++; if (kind === 'network') throw new TypeError(registrationInput.password);
    return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('timeout', 'AbortError'))));
  } }); api.csrf = { headerName: 'X-CSRF', token: 'existing' };
  await assert.rejects(api.register(registrationInput), e => {
    assert.equal(e.code, kind === 'network' ? 'NETWORK_ERROR' : 'REQUEST_TIMEOUT'); assert.ok(errorText(e).includes('Chưa xác nhận'));
    assert.ok(errorText(e).includes('đăng nhập')); assert.ok(!String(e).includes(registrationInput.password)); return true;
  }); assert.equal(calls, 1);
});
test('403 needs manual CSRF refresh and manual submit; failed bootstrap sends no POST', async () => {
  const calls = [];
  const api = new ApiClient({ fetchImpl: async (path, options) => {
    calls.push(path); if (path.endsWith('/csrf')) return json({ headerName: 'X-CSRF', token: 'fresh' });
    return options.headers['X-CSRF'] === 'fresh' ? json(registeredUser, 201) : json({ code: 'ACCESS_DENIED' }, 403);
  } }); api.csrf = { headerName: 'X-CSRF', token: 'stale' };
  await assert.rejects(api.register(registrationInput), e => e.status === 403); assert.deepEqual(calls, ['/api/v1/auth/register']);
  await api.refreshCsrf(); assert.deepEqual(calls, ['/api/v1/auth/register', '/api/v1/auth/csrf']); await api.register(registrationInput);
  assert.deepEqual(calls, ['/api/v1/auth/register', '/api/v1/auth/csrf', '/api/v1/auth/register']);
  const failing = new ApiClient({ fetchImpl: async path => { assert.equal(path, '/api/v1/auth/csrf'); return json({ code: 'AUTH_UNAVAILABLE' }, 503); } });
  await assert.rejects(failing.register(registrationInput), e => e.status === 503);
});
test('late registration cannot confirm success or overwrite a new auth epoch', async () => {
  let finish;
  const api = new ApiClient({ fetchImpl: () => new Promise(resolve => { finish = resolve; }) }); api.csrf = { headerName: 'X-CSRF', token: 'old' };
  const pending = api.register(registrationInput); api.invalidateCsrf(); const next = { headerName: 'X-CSRF', token: 'new' }; api.csrf = next;
  finish(json(registeredUser, 201)); await assert.rejects(pending, e => e.code === 'SESSION_CHANGED'); assert.equal(api.csrf, next);
});
