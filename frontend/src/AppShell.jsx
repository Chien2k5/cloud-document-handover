import { useRef, useState } from 'react';
import { Button } from './ui.jsx';
import { focusWorkspaceSection, projectHash } from './navigation.js';

function NavIcon({ kind }) {
  const paths = {
    projects: 'M3 6h6l2 2h10v12H3z M3 6V4h6l2 2',
    handovers: 'M4 5h16v15H4z M8 3v4 M16 3v4 M8 12h8 M8 16h5',
    overview: 'M3 10l9-7 9 7 M5 9v12h14V9 M9 21v-7h6v7',
    files: 'M6 3h8l4 4v14H6z M14 3v5h5 M9 12h6 M9 16h6',
    members: 'M15 21v-3a4 4 0 0 0-8 0v3 M19 21v-3a4 4 0 0 0-3-4 M11 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6 M17 5a3 3 0 0 1 0 6',
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[kind]} /></svg>;
}

export default function AppShell({ user, busy, onLogout, route, selectedProjectId, onNavigate, children }) {
  const [open, setOpen] = useState(false), toggle = useRef(null);
  const navigate = (event, hash) => { event.preventDefault(); setOpen(false); onNavigate(hash); };
  const link = (kind, label, hash, active) => <a href={hash} className={`sidebar-link${active ? ' is-active' : ''}`} aria-current={active ? 'location' : undefined} onClick={event => navigate(event, hash)}><NavIcon kind={kind} /><span>{label}</span></a>;
  return <div className="app-shell" onKeyDown={event => { if (event.key === 'Escape' && open) { setOpen(false); toggle.current?.focus(); } }}>
    <a className="skip-link" href="#workspace-main" onClick={event => { event.preventDefault(); focusWorkspaceSection('workspace-main'); }}>Bỏ qua điều hướng</a>
    <header className="app-header">
      <div className="app-header__brand"><span className="brand-mark" aria-hidden="true">CH</span><div><h1>Cloud Handover</h1><p>Không gian tài liệu của nhóm</p></div></div>
      <div className="account-area"><div className="account-area__identity"><strong>{user.displayName}</strong><span>{user.email}</span></div><Button variant="secondary" disabled={busy} onClick={onLogout}>Đăng xuất</Button></div>
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
          </div>}
        </nav>
        <div className="sidebar-note">Tài liệu theo dự án.<br />Bàn giao đúng phiên bản.</div>
      </aside>
      <main className="workspace-content" id="workspace-main" tabIndex={-1}>{children}</main>
    </div>
  </div>;
}
