import { ApiError, segment } from './api.js';

export const MAX_FILE_BYTES = 100 * 1024 * 1024;
export function validateFile(file) {
  if (!file || !Number.isInteger(file.size) || file.size < 1 || file.size > MAX_FILE_BYTES) throw new ApiError(0, 'INVALID_FILE_SIZE');
}
export async function fileSha256(file, signal) {
  validateFile(file); signal?.throwIfAborted();
  const bytes = await file.arrayBuffer(); signal?.throwIfAborted();
  const digest = await crypto.subtle.digest('SHA-256', bytes); signal?.throwIfAborted();
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
export const uploadPath = (projectId, uploadId) => `/projects/${segment(projectId)}/files/uploads/${segment(uploadId)}`;
export function completeUpload(api, session, signal) {
  if (typeof session.versionId !== 'string' || !session.versionId.trim() || session.versionId === 'null') throw new ApiError(0, 'MISSING_VERSION_ID');
  return api.request(uploadPath(session.projectId, session.uploadId) + '/complete', { method: 'POST', body: { versionId: session.versionId }, signal });
}
export async function startUpload(api, projectId, file, {
  fileId, signal, onProgress = () => {}, onSession = () => {},
  fetchImpl = (...args) => fetch(...args), putTimeoutMs = 120000,
} = {}) {
  onProgress('Đang tính SHA-256…');
  const expectedSha256 = await fileSha256(file, signal);
  const body = { filename: file.name, contentType: file.type || 'application/octet-stream', size: file.size, expectedSha256 };
  if (fileId) body.fileId = fileId;
  signal?.throwIfAborted(); onProgress('Đang tạo phiên upload…');
  const created = await api.request(`/projects/${segment(projectId)}/files/uploads`, { method: 'POST', body, signal });
  const session = { projectId, uploadId: created.uploadId, fileVersionId: created.fileVersionId, fileId: created.fileId, versionId: null };
  onSession(session); signal?.throwIfAborted();
  const signed = created.presignedUpload;
  if (signed?.method !== 'PUT' || typeof signed.url !== 'string' || !signed.headers || !created.uploadId) throw new ApiError(0, 'INVALID_SIGNED_UPLOAD');
  const names = new Set(), headers = {};
  for (const [name, value] of Object.entries(signed.headers)) {
    const normalized = name.toLowerCase();
    if (names.has(normalized) || typeof value !== 'string') throw new ApiError(0, 'INVALID_SIGNED_UPLOAD');
    names.add(normalized); headers[normalized] = value;
  }
  if (headers['content-type'] !== body.contentType || headers['if-none-match'] !== '*') throw new ApiError(0, 'INVALID_SIGNED_UPLOAD');
  let destination;
  try { destination = new URL(signed.url); } catch { throw new ApiError(0, 'INVALID_SIGNED_UPLOAD'); }
  if (destination.protocol !== 'https:' || destination.username || destination.password) throw new ApiError(0, 'INVALID_SIGNED_UPLOAD');
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), putTimeoutMs);
  let response;
  onProgress('Đang gửi file lên S3…');
  try {
    response = await fetchImpl(signed.url, { method: 'PUT', headers: { ...signed.headers }, body: file,
      credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
      signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal });
  } catch {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    throw new ApiError(0, controller.signal.aborted ? 'S3_TIMEOUT' : 'S3_NETWORK_ERROR');
  } finally { clearTimeout(timeout); }
  if (!response.ok) throw new ApiError(response.status, response.status === 412 ? 'S3_ALREADY_EXISTS' : response.status === 409 ? 'S3_CONFLICT' : 'S3_PUT_FAILED');
  const versionId = response.headers.get('x-amz-version-id');
  if (!versionId || !versionId.trim() || versionId === 'null') throw new ApiError(0, 'MISSING_VERSION_ID');
  session.versionId = versionId; onSession({ ...session }); signal?.throwIfAborted();
  onProgress('Đang complete đúng phiên bản S3…');
  return { session, state: await completeUpload(api, session, signal) };
}
export function shouldPoll(file) {
  return file?.uploadStatus === 'AVAILABLE' && ['INTEGRITY_PENDING', 'FAILED'].includes(file.integrityStatus);
}
export async function pollUpload(api, projectId, uploadId, {
  signal, attempts = 15, delayMs = 2000, onState = () => {},
} = {}) {
  for (let index = 0; index < attempts; index++) {
    signal?.throwIfAborted();
    const state = await api.request(uploadPath(projectId, uploadId), { signal });
    signal?.throwIfAborted(); onState(state);
    if (!shouldPoll(state.fileVersion) || state.fileVersion.integrityStatus === 'FAILED') return { state, stopped: 'status' };
    if (index + 1 < attempts) await new Promise((resolve, reject) => {
      const cleanup = () => signal?.removeEventListener('abort', abort);
      const timer = setTimeout(() => { cleanup(); resolve(); }, delayMs);
      const abort = () => { clearTimeout(timer); cleanup(); reject(new DOMException('Cancelled', 'AbortError')); };
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
    });
  }
  return { stopped: 'limit' };
}
