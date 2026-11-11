import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiClient, ApiError, errorText } from '../src/api.js';

const user = { id: '70000000-0000-0000-0000-000000000007', email: 'fixture@example.test', displayName: 'Fixture' };
const input = { displayName: 'Fixture', email: user.email, password: '  CaseFixtureR07#  ', confirmPassword: '  CaseFixtureR07#  ' };
const csrf = { headerName: 'X-R07-CSRF', token: 'masked-fixture' };
for (const field of ['id', 'email']) test(`R07 UNIT: missing ${field} cannot confirm 201`, async () => {
  const body = { ...user }; delete body[field]; let posts = 0;
  const api = new ApiClient({ fetchImpl: async (path, options) => {
    assert.equal(path, '/api/v1/auth/register'); assert.equal(options.method, 'POST'); posts++;
    return Response.json(body, { status: 201 });
  } }); api.csrf = csrf;
  await assert.rejects(api.register(input), error => error instanceof ApiError && error.code === 'INVALID_RESPONSE' && error.operation === 'register');
  assert.equal(posts, 1); assert.equal(api.csrf, csrf); assert.equal(api.authEpoch, 0);
});
for (const field of ['id', 'email']) test(`R07 UNIT: numeric ${field} is not a public User string`, async () => {
  let calls = 0;
  const api = new ApiClient({ fetchImpl: async () => { calls++; return Response.json({ ...user, [field]: 123 }, { status: 201 }); } }); api.csrf = csrf;
  await assert.rejects(api.register(input), error => error.code === 'INVALID_RESPONSE' && errorText(error).includes('Hãy thử đăng nhập trước khi gửi đăng ký lại.'));
  assert.equal(calls, 1);
});
for (const missing of ['headerName', 'token']) test(`R07 UNIT: incomplete CSRF bootstrap (${missing}) sends no credential-bearing POST`, async () => {
  const body = { ...csrf }; delete body[missing]; const calls = [];
  const api = new ApiClient({ fetchImpl: async (path, options) => { calls.push({ path, ...options }); return Response.json(body); } });
  await assert.rejects(api.register(input), error => error.code === 'INVALID_RESPONSE' && error.operation === 'register');
  assert.equal(calls.length, 1); assert.equal(calls[0].path, '/api/v1/auth/csrf'); assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].body, undefined); assert.equal(calls[0].credentials, 'include'); assert.equal(api.csrf, null);
});
for (const kind of ['network', 'timeout']) test(`R07 UNIT: CSRF bootstrap ${kind} never reaches mutation and never retries`, async () => {
  const calls = [];
  const api = new ApiClient({ timeoutMs: 5, fetchImpl: async (path, options) => {
    calls.push({ path, ...options });
    if (kind === 'network') throw new TypeError('fixture unavailable');
    return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }));
  } });
  await assert.rejects(api.register(input), error => {
    assert.equal(error.code, kind === 'network' ? 'NETWORK_ERROR' : 'REQUEST_TIMEOUT');
    assert.ok(errorText(error).includes('đăng nhập')); assert.equal(String(error).includes(input.password), false); return true;
  });
  assert.deepEqual(calls.map(call => [call.path, call.method, call.body]), [['/api/v1/auth/csrf', 'GET', undefined]]);
  assert.equal(api.csrf, null); assert.equal(api.authEpoch, 0);
});
test('R07 UNIT: a previous-session CSRF bootstrap cannot post old credentials or replace a newer token', async () => {
  const gate = Promise.withResolvers(), calls = []; let bootstraps = 0;
  const api = new ApiClient({ fetchImpl: async (path, options) => {
    calls.push({ path, ...options });
    if (path.endsWith('/csrf')) return ++bootstraps === 1 ? gate.promise : Response.json({ ...csrf, token: 'fresh' });
    assert.equal(options.headers[csrf.headerName], 'fresh'); return Response.json({ ...user, email: JSON.parse(options.body).email.trim().toLowerCase() }, { status: 201 });
  } });
  const old = api.register(input); const oldResult = assert.rejects(old, error => error.code === 'SESSION_CHANGED');
  api.invalidateCsrf();
  const current = { ...input, email: 'current@example.test', password: 'CurrentFixtureR07#', confirmPassword: 'CurrentFixtureR07#' };
  await api.register(current); gate.resolve(Response.json({ ...csrf, token: 'obsolete' })); await oldResult;
  const posts = calls.filter(call => call.method === 'POST'); assert.equal(posts.length, 1); assert.deepEqual(JSON.parse(posts[0].body), current);
  assert.equal(api.csrf.token, 'fresh'); assert.equal(bootstraps, 2); assert.ok(calls.every(call => !call.path.endsWith('/login') && !call.path.endsWith('/me')));
});
test('R07 UNIT: two intentional registrations share bootstrap but keep payloads, errors and results independent', async () => {
  const gate = Promise.withResolvers(), calls = []; let bootstraps = 0, unauthorized = 0;
  const api = new ApiClient({ onUnauthorized: () => unauthorized++, fetchImpl: async (path, options) => {
    calls.push({ path, ...options });
    if (path.endsWith('/csrf')) { bootstraps++; return gate.promise; }
    const body = JSON.parse(options.body); assert.equal(options.headers[csrf.headerName], csrf.token);
    return body.email === input.email ? Response.json({ code: 'EMAIL_ALREADY_EXISTS', requestId: 'fixture-request' }, { status: 409 }) : Response.json({ ...user, email: body.email }, { status: 201 });
  } });
  const second = { ...input, email: 'second@example.test', password: 'DifferentFixtureR07#', confirmPassword: 'DifferentFixtureR07#' };
  const results = Promise.allSettled([api.register(input), api.register(second)]);
  assert.equal(bootstraps, 1); assert.equal(calls.filter(call => call.method === 'POST').length, 0);
  gate.resolve(Response.json(csrf)); const [one, two] = await results;
  assert.equal(one.status, 'rejected'); assert.equal(one.reason.code, 'EMAIL_ALREADY_EXISTS'); assert.equal(two.status, 'fulfilled'); assert.equal(two.value.email, second.email);
  assert.deepEqual(calls.filter(call => call.method === 'POST').map(call => JSON.parse(call.body)), [input, second]);
  assert.equal(calls.length, 3); assert.equal(unauthorized, 0); assert.equal(api.authEpoch, 0); assert.deepEqual(api.csrf, csrf);
});
test('R07 UNIT: Unicode and URL metacharacters remain exact JSON data without changing endpoint or session', async () => {
  const password = 'ắ'.repeat(24), raw = { displayName: '  Nhóm Đăng – Dũng & < >  ', email: '  ĐẶNG+tag@Example.TEST  ', password, confirmPassword: password };
  assert.equal(new TextEncoder().encode(password).length, 72); assert.equal([...password].length, 24);
  let calls = 0;
  const api = new ApiClient({ fetchImpl: async (path, options) => {
    calls++; assert.equal(path, '/api/v1/auth/register'); assert.equal(options.method, 'POST'); assert.equal(options.credentials, 'include');
    assert.equal(options.headers['Content-Type'], 'application/json'); assert.deepEqual(JSON.parse(options.body), raw);
    assert.equal(path.includes(encodeURIComponent(password)), false); return Response.json({ ...user, email: raw.email.trim().toLowerCase(), displayName: raw.displayName.trim() }, { status: 201 });
  } }); api.csrf = csrf;
  await api.register(raw); assert.equal(calls, 1); assert.equal(api.csrf, csrf); assert.equal(api.authEpoch, 0);
});
