import { useState } from 'react';
import { api } from './client.js';
import { errorText } from './api.js';
export function Button({ type = 'button', variant = 'primary', className = '', ...props }) {
  return <button type={type} className={`button button--${variant} ${className}`.trim()} {...props} />;
}
export function Card({ className = '', ...props }) {
  return <section className={`card ${className}`.trim()} {...props} />;
}
export function PageHeader({ title, description, actions }) {
  return <div className="page-header"><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{actions && <div className="page-header__actions">{actions}</div>}</div>;
}
export function LoadingState({ children = 'Đang tải…' }) {
  return <div className="loading-state" role="status"><span className="loading-state__dot" aria-hidden="true" /><span>{children}</span></div>;
}
export function ErrorNotice({ error }) {
  const [refreshed, setRefreshed] = useState(false);
  return error ? <div className="error" role="alert"><p>{errorText(error)}</p>{error.status === 403 && <Button variant="secondary" onClick={() => api.refreshCsrf().then(() => setRefreshed(true)).catch(() => setRefreshed(false))}>Làm mới CSRF</Button>}{refreshed && <p>Đã lấy token mới. Kiểm tra quyền rồi thử lại thao tác.</p>}</div> : null;
}
export function Pager({ page, count, size = 20, busy, onPage }) {
  return <nav className="pagination" aria-label="Phân trang"><Button variant="secondary" disabled={busy || page === 0} onClick={() => onPage(page - 1)}>Trang trước</Button><span> Trang {page + 1} </span><Button variant="secondary" disabled={busy || count < size} onClick={() => onPage(page + 1)}>Trang sau</Button></nav>;
}

export function EmptyState({ title, description }) {
  return <div className="empty-state"><span className="empty-state__symbol" aria-hidden="true">▱</span><h3>{title}</h3><p>{description}</p></div>;
}
export function StatusBadge({ children }) {
  return <span className="status-badge" data-role={children}>{children}</span>;
}

export function TechnicalDetails({ title = 'Thông tin kỹ thuật', children }) {
  return <details className="technical-details"><summary>{title}</summary>{children}</details>;
}

export function ProjectSymbol() {
  return <span className="project-symbol" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7h6l2 2h10v11H3z M3 7V4h6l2 3h8v2" /></svg></span>;
}
