import { ApiError } from './api.js';
export function updateVersion(items, version) {
  return items.map(item => {
    if (item.id !== version.id || item.uploadId !== version.uploadId) return item;
    if (item.versionId && item.versionId !== version.versionId) return item;
    if (item.uploadStatus === 'AVAILABLE' && version.uploadStatus !== 'AVAILABLE') return item;
    if (['VERIFIED', 'MISMATCH'].includes(item.integrityStatus) && item.integrityStatus !== version.integrityStatus) return item;
    return version;
  });
}
export function downloadUrl(download) {
  const url = new URL(download.url);
  if (url.protocol !== 'https:' || url.username || url.password || !(Date.parse(download.expiresAt) > Date.now())) throw new ApiError(0, 'INVALID_DOWNLOAD');
  return url.href;
}
