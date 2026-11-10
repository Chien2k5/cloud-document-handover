import { ApiClient } from './api.js';
export const api = new ApiClient({ onUnauthorized: error => window.dispatchEvent(new CustomEvent('portal-session-expired', { detail: error })) });
