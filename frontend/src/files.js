import { ApiError } from './api.js';
export function updateVersion(items, version) {
  return items.map(item => item.id === version.id && item.uploadId === version.uploadId ? version : item);
}
export function downloadUrl(download) {
  const url = new URL(download.url);
  if (url.protocol !== 'https:' || url.username || url.password || !(Date.parse(download.expiresAt) > Date.now())) throw new ApiError(0, 'INVALID_DOWNLOAD');
  return url.href;
}
