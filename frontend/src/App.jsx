import { useCallback, useEffect, useState } from 'react';
import { api } from './client.js';
import { Button, Card, ErrorNotice, LoadingState, PageHeader } from './ui.jsx';
import Projects from './Projects.jsx';
import Handovers from './Handovers.jsx';
import AppShell from './AppShell.jsx';
import { focusWorkspaceSection, handoverHash, projectHash, readWorkspaceHash } from './navigation.js';
export default function App() {
  const [user, setUser] = useState(null), [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false), [error, setError] = useState(null);
  const [email, setEmail] = useState(''), [password, setPassword] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    api.request('/auth/me', { signal: controller.signal, notifyUnauthorized: false }).then(setUser).catch(e => {
      if (e.status !== 401 && e.name !== 'AbortError') setError(e);
    }).finally(() => setLoading(false));
    const expired = event => { setUser(null); setPassword(''); setError(event.detail); };
    window.addEventListener('portal-session-expired', expired);
    return () => { controller.abort(); window.removeEventListener('portal-session-expired', expired); };
  }, []);
  async function login(event) {
    event.preventDefault(); setBusy(true); setError(null);
    try { setUser(await api.login(email.trim(), password)); } catch (e) { setError(e); }
    finally { setPassword(''); setBusy(false); }
  }
  async function logout() {
    setBusy(true); setError(null);
    try { await api.logout(); setUser(null); } catch (e) { setError(e); if (!api.csrf) setUser(null); }
    finally { setBusy(false); }
  }
  if (!loading && user) return <Portal key={user.id} user={user} busy={busy} error={error} onLogout={logout} />;
  return <div className="container container--guest"><div className="guest-panel">
    <header className="guest-brand"><span className="brand-mark" aria-hidden="true">CH</span><h1>Cloud Handover</h1><p>Không gian tài liệu của nhóm</p></header>
    <ErrorNotice error={error} />
    {loading ? <LoadingState>Đang kiểm tra phiên đăng nhập…</LoadingState> : !user ? <Card>
      <PageHeader title="Đăng nhập" description="Truy cập dự án và các gói bàn giao được cấp quyền." /><form onSubmit={login}>
        <label>Email<input type="email" name="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} /></label>
        <label>Mật khẩu<input type="password" name="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></label>
        <Button type="submit" disabled={busy}>{busy ? 'Đang đăng nhập…' : 'Đăng nhập'}</Button>
      </form>
    </Card> : null}
  </div></div>;
}
function Portal({ user, busy, error, onLogout }) {
  const [route, setRoute] = useState(() => readWorkspaceHash(window.location.hash));
  const [selected, setSelected] = useState(() => readWorkspaceHash(window.location.hash).projectId || null);
  const [handoverId, setHandoverId] = useState(() => readWorkspaceHash(window.location.hash).handoverId || null);
  const applyRoute = useCallback(hash => {
    const next = readWorkspaceHash(hash); setRoute(next);
    if (next.projectId) setSelected(next.projectId);
    if (next.handoverId) setHandoverId(next.handoverId);
  }, []);
  const navigate = useCallback(hash => { applyRoute(hash); if (window.location.hash !== hash) window.location.hash = hash; }, [applyRoute]);
  useEffect(() => {
    const changed = () => applyRoute(window.location.hash);
    window.addEventListener('hashchange', changed); return () => window.removeEventListener('hashchange', changed);
  }, [applyRoute]);
  useEffect(() => { if (route.view !== 'project') focusWorkspaceSection(route.view === 'handovers' ? 'workspace-handovers' : 'workspace-projects'); }, [route]);
  function openHandover(id) { setHandoverId(id); navigate(handoverHash(id)); }
  return <AppShell user={user} busy={busy} onLogout={onLogout} route={route} selectedProjectId={selected} onNavigate={navigate}>
    <ErrorNotice error={error} />
    {route.invalid && <p className="route-notice" role="status">Đường dẫn không hợp lệ. Chọn một mục trong workspace hoặc nhập UUID gói được cấp quyền.</p>}
    <Projects user={user} selected={selected} onSelectProject={id => navigate(projectHash(id))} navigation={route} onHandoverCreated={openHandover} />
    <div hidden={route.view !== 'handovers'} inert={route.view !== 'handovers'}><Handovers user={user} activeId={route.invalid && route.view === 'handovers' ? null : handoverId} onSelect={openHandover} /></div>
  </AppShell>;
}
