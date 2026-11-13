import { useEffect, useId, useRef, useState } from 'react';
import { Button } from './ui.jsx';
import { focusWorkspaceSection, projectHash } from './navigation.js';

function NavIcon({ kind }) {
  const paths = {
    projects: 'M3 6h6l2 2h10v12H3z M3 6V4h6l2 2',
    handovers: 'M4 5h16v15H4z M8 3v4 M16 3v4 M8 12h8 M8 16h5',
    overview: 'M3 10l9-7 9 7 M5 9v12h14V9 M9 21v-7h6v7',
    files: 'M6 3h8l4 4v14H6z M14 3v5h5 M9 12h6 M9 16h6',
    draft: 'M4 5h16v15H4z M8 3v4 M16 3v4 M8 13h8 M12 9v8',
    members: 'M15 21v-3a4 4 0 0 0-8 0v3 M19 21v-3a4 4 0 0 0-3-4 M11 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6 M17 5a3 3 0 0 1 0 6',
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[kind]} /></svg>;
}

function AccountProfile({ user, busy }) {
  const [open, setOpen] = useState(false), [copying, setCopying] = useState(false), [notice, setNotice] = useState(null);
  const trigger = useRef(null), attempt = useRef({ sequence: 0, pending: false });
  const panelId = useId(), uuidId = useId();
  useEffect(() => () => { attempt.current.sequence++; }, []);
  function setExpanded(value) {
    attempt.current.sequence++; attempt.current.pending = false;
    setCopying(false); setNotice(null); setOpen(value);
  }
  async function copyUuid() {
    if (attempt.current.pending) return;
    const sequence = ++attempt.current.sequence;
    attempt.current.pending = true; setCopying(true); setNotice(null);
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(user.id);
      if (sequence === attempt.current.sequence) setNotice({ success: true, text: 'Đã sao chép UUID.' });
    } catch {
      if (sequence === attempt.current.sequence) setNotice({ success: false, text: 'Không thể sao chép tự động. Vui lòng chọn UUID và sao chép thủ công.' });
    } finally {
      if (sequence === attempt.current.sequence) { attempt.current.pending = false; setCopying(false); }
    }
  }
  return <div className="account-profile" onKeyDown={event => {
    if (event.key === 'Escape' && open) { event.stopPropagation(); setExpanded(false); trigger.current?.focus(); }
  }}>
    <Button ref={trigger} variant="secondary" disabled={busy} aria-expanded={open} aria-controls={panelId} onClick={() => setExpanded(!open)}>Thông tin tài khoản</Button>
    {open && <section className="account-profile__panel" id={panelId} aria-label="Thông tin tài khoản">
      <h2>Thông tin tài khoản</h2>
      <dl>
        <div><dt>Tên tài khoản</dt><dd>{user.displayName}</dd></div>
        <div><dt>Email</dt><dd>{user.email}</dd></div>
        <div><dt><label htmlFor={uuidId}>UUID tài khoản</label></dt><dd><textarea id={uuidId} readOnly rows={2} value={user.id} onFocus={event => event.currentTarget.select()} /></dd></div>
      </dl>
      <Button type="button" disabled={busy || copying} onClick={copyUuid}>{copying ? 'Đang sao chép…' : 'Sao chép UUID'}</Button>
      {notice && <p className="account-profile__notice" role={notice.success ? 'status' : 'alert'}>{notice.text}</p>}
    </section>}
  </div>;
}

export default function AppShell({ user, busy, onLogout, route, selectedProjectId, onNavigate, children }) {
  const [open, setOpen] = useState(false), toggle = useRef(null);
  const navigate = (event, hash) => { event.preventDefault(); setOpen(false); onNavigate(hash); };
  const link = (kind, label, hash, active) => <a href={hash} className={`sidebar-link${active ? ' is-active' : ''}`} aria-current={active ? 'location' : undefined} onClick={event => navigate(event, hash)}><NavIcon kind={kind} /><span>{label}</span></a>;
  return <div className="app-shell" onKeyDown={event => { if (event.key === 'Escape' && open) { setOpen(false); toggle.current?.focus(); } }}>
    <a className="skip-link" href="#workspace-main" onClick={event => { event.preventDefault(); focusWorkspaceSection('workspace-main'); }}>Bỏ qua điều hướng</a>
    <header className="app-header">
      <div className="app-header__brand"><span className="brand-mark" aria-hidden="true">CH</span><div><h1>Cloud Handover</h1><p>Không gian tài liệu của nhóm</p></div></div>
      <div className="account-area account-area--profile"><div className="account-area__identity"><strong>{user.displayName}</strong><span>{user.email}</span></div><AccountProfile key={user.id} user={user} busy={busy} /><Button variant="secondary" disabled={busy} onClick={onLogout}>Đăng xuất</Button></div>
      <button ref={toggle} className="sidebar-toggle button--secondary" type="button" aria-label={open ? 'Đóng điều hướng' : 'Mở điều hướng'} aria-expanded={open} aria-controls="workspace-sidebar" onClick={() => setOpen(value => !value)}><span aria-hidden="true">☰</span> Điều hướng</button>
    </header>
    <div className="app-layout">
      <aside className="app-sidebar" id="workspace-sidebar" data-open={open} aria-label="Thanh bên workspace">
        <nav aria-label="Điều hướng workspace"><p className="sidebar-caption">Không gian làm việc</p>
          {link('projects', 'Dự án', '#/projects', route.view === 'projects')}
          {link('handovers', 'Mở gói bàn giao', '#/handovers', route.view === 'handovers')}
          {selectedProjectId && <div className="sidebar-project"><p className="sidebar-caption">Trong dự án</p>
            {link('overview', 'Tổng quan', projectHash(selectedProjectId), route.view === 'project' && route.section === 'overview')}
            {link('files', 'Tài liệu', projectHash(selectedProjectId, 'files'), route.view === 'project' && route.section === 'files')}
            {link('members', 'Thành viên', projectHash(selectedProjectId, 'members'), route.view === 'project' && route.section === 'members')}
            {link('draft', 'Tạo gói DRAFT', projectHash(selectedProjectId, 'draft'), route.view === 'project' && route.section === 'draft')}
          </div>}
        </nav>
        <div className="sidebar-note">Tài liệu theo dự án.<br />Bàn giao đúng phiên bản.</div>
      </aside>
      <main className="workspace-content" id="workspace-main" tabIndex={-1} aria-label={route.view === 'handovers' ? 'Mở gói bàn giao' : route.view === 'project' ? 'Không gian dự án' : 'Dự án'}>{children}</main>
    </div>
  </div>;
}
