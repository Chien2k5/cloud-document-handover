import { useState } from 'react';
import { api } from './client.js';
import { errorText } from './api.js';
export function ErrorNotice({ error }) {
  const [refreshed, setRefreshed] = useState(false);
  return error ? <div className="error" role="alert"><p>{errorText(error)}</p>{error.status === 403 && <button type="button" onClick={() => api.refreshCsrf().then(() => setRefreshed(true)).catch(() => setRefreshed(false))}>Làm mới CSRF</button>}{refreshed && <p>Đã lấy token mới. Kiểm tra quyền rồi thử lại thao tác.</p>}</div> : null;
}
export function Pager({ page, count, size = 20, busy, onPage }) {
  return <nav aria-label="Phân trang"><button disabled={busy || page === 0} onClick={() => onPage(page - 1)}>Trang trước</button><span> Trang {page + 1} </span><button disabled={busy || count < size} onClick={() => onPage(page + 1)}>Trang sau</button></nav>;
}
