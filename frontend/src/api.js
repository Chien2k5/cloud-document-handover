export class ApiError extends Error {
  constructor(status, code, requestId = '') {
    super(code); this.name = 'ApiError'; this.status = status; this.code = code; this.requestId = requestId;
  }
}
const messages = {
  INVALID_CREDENTIALS: 'Email hoặc mật khẩu không đúng.',
  UNAUTHENTICATED: 'Phiên đăng nhập đã hết. Vui lòng đăng nhập lại.',
  ACCOUNT_DISABLED: 'Tài khoản đã bị vô hiệu hóa.',
  ACCESS_DENIED: 'Không đủ quyền hoặc CSRF đã hết hạn. Làm mới CSRF rồi thử lại thao tác.',
  OWNER_REQUIRED: 'Thao tác này chỉ dành cho Owner.',
  OWNER_IMMUTABLE: 'Không thể thay đổi hoặc xóa Owner.',
  PROJECT_NOT_FOUND: 'Dự án không tồn tại hoặc bạn không còn quyền truy cập.',
  USER_NOT_FOUND: 'Không tìm thấy tài khoản người nhận/thành viên.',
  HANDOVER_NOT_FOUND: 'Gói không tồn tại hoặc bạn không phải người được cấp quyền.',
  FILE_NOT_VERIFIED: 'File chưa được xác minh. Kiểm tra trạng thái trước khi tiếp tục.',
  FILE_NOT_AVAILABLE: 'File chưa hoàn tất upload.',
  STORAGE_UNAVAILABLE: 'Không truy cập được S3. Kiểm tra cấu hình hoặc thử lại sau.',
  AUTH_UNAVAILABLE: 'Dịch vụ xác thực tạm thời không sẵn sàng.',
  QUOTA_EXCEEDED: 'Dự án không còn đủ quota. Upload đang chờ cũng giữ quota.',
  UPLOAD_EXPIRED: 'Phiên upload đã hết hạn. Tạo upload mới khi quota cho phép.',
  OBJECT_NOT_READY: 'Phiên bản S3 chưa sẵn sàng hoặc không còn tồn tại.',
  UPLOAD_OBJECT_INVALID: 'Kích thước hoặc Content-Type trên S3 không khớp.',
  HANDOVER_EXPIRED: 'Gói bàn giao đã hết hạn.', HANDOVER_REVOKED: 'Gói bàn giao đã bị thu hồi.',
  VALIDATION_ERROR: 'Dữ liệu không hợp lệ. Kiểm tra các trường bắt buộc.',
  NETWORK_ERROR: 'Không kết nối được máy chủ. Kiểm tra mạng và backend.',
  REQUEST_TIMEOUT: 'Yêu cầu hết thời gian chờ; thao tác có thể đã được máy chủ nhận. Kiểm tra trạng thái trước khi thử lại.',
  INVALID_RESPONSE: 'Máy chủ trả dữ liệu không đúng định dạng API.',
  INVALID_FILE_SIZE: 'Chọn file từ 1 byte đến 100 MiB.',
  FILE_NAME_CONFLICT: 'Phiên bản mới phải giữ nguyên tên file của tài liệu đã chọn.',
  INVALID_DOWNLOAD: 'Liên kết tải không hợp lệ hoặc đã hết hạn. Lấy link mới từ backend.',
  INVALID_SIGNED_UPLOAD: 'Backend trả thông tin upload không hợp lệ. Không gửi file.',
  MISSING_VERSION_ID: 'Không đọc được S3 Version ID. Kiểm tra Versioning và CORS expose x-amz-version-id. Không complete hoặc đoán latest; chờ phiên cũ hết hạn rồi tạo upload mới.',
  S3_ALREADY_EXISTS: 'S3 trả 412: key đã tồn tại. Không tự PUT lại hoặc complete khi thiếu Version ID; chờ hết hạn và tạo upload mới.',
  S3_CONFLICT: 'S3 trả 409: ghi xung đột. Không tự gửi lại file; kiểm tra phiên upload.',
  S3_PUT_FAILED: 'S3 từ chối upload. Kiểm tra quyền, signed headers và hạn URL.',
  S3_TIMEOUT: 'Upload S3 hết thời gian chờ. File có thể đã được gửi; không đoán Version ID hoặc tự retry PUT.',
  S3_NETWORK_ERROR: 'Không nhận được phản hồi S3. Kiểm tra mạng/CORS; file có thể đã được gửi. Không tự retry PUT.',
};
export function errorText(error) {
  if (error?.name === 'AbortError') return 'Đã hủy thao tác.';
  const message = messages[error?.code] || (error?.status === 403 ? messages.ACCESS_DENIED
    : error?.status === 404 ? 'Không tìm thấy dữ liệu hoặc không có quyền truy cập.'
      : error?.status === 409 ? 'Trạng thái đã thay đổi. Tải lại dữ liệu trước khi thử lại.'
        : error?.status >= 500 ? 'Dịch vụ tạm thời không sẵn sàng.' : 'Không thực hiện được thao tác.');
  return message + (error?.requestId ? ` Mã đối chiếu: ${error.requestId}` : '');
}
export class ApiClient {
  constructor({ fetchImpl = (...args) => fetch(...args), onUnauthorized = () => {}, timeoutMs = 20000 } = {}) {
    this.fetchImpl = fetchImpl; this.onUnauthorized = onUnauthorized; this.timeoutMs = timeoutMs; this.csrf = null;
  }
  async refreshCsrf() {
    const csrf = await this.request('/auth/csrf');
    if (!csrf?.headerName || !csrf?.token) throw new ApiError(0, 'INVALID_RESPONSE');
    this.csrf = csrf; return csrf;
  }
  async request(path, { method = 'GET', body, form, signal, timeoutMs = this.timeoutMs } = {}) {
    if (!path.startsWith('/') || path.startsWith('//') || path.includes('://')) throw new Error('Internal API path required');
    const headers = { Accept: 'application/json' };
    if (!['GET', 'HEAD'].includes(method)) {
      if (!this.csrf) await this.refreshCsrf();
      headers[this.csrf.headerName] = this.csrf.token;
    }
    let payload;
    if (form) { headers['Content-Type'] = 'application/x-www-form-urlencoded'; payload = new URLSearchParams(form).toString(); }
    else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.fetchImpl('/api/v1' + path, { method, headers, body: payload, credentials: 'include',
        signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal });
      let data = null;
      if (response.status !== 204) {
        try { data = await response.json(); } catch { throw new ApiError(response.status, 'INVALID_RESPONSE'); }
      }
      if (!response.ok) {
        const error = new ApiError(response.status, data?.code || 'HTTP_ERROR', data?.requestId || '');
        if (response.status === 401 && path !== '/auth/login') { this.csrf = null; this.onUnauthorized(error); }
        throw error;
      }
      return data;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      throw new ApiError(0, controller.signal.aborted ? 'REQUEST_TIMEOUT' : 'NETWORK_ERROR');
    } finally { clearTimeout(timeout); }
  }
  async login(email, password) {
    await this.refreshCsrf();
    await this.request('/auth/login', { method: 'POST', form: { email, password } });
    this.csrf = null; await this.refreshCsrf(); return this.request('/auth/me');
  }
  async logout() {
    await this.request('/auth/logout', { method: 'POST' });
    this.csrf = null; await this.refreshCsrf();
  }
}
export const segment = value => encodeURIComponent(value);
