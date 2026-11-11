import { useCallback, useEffect, useRef, useState } from 'react';
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
  const [authMode, setAuthMode] = useState('login');
  const [registration, setRegistration] = useState({ displayName: '', email: '', password: '', confirmPassword: '' });
  const [registrationErrors, setRegistrationErrors] = useState({}), [registrationNotice, setRegistrationNotice] = useState('');
  const [registrationBusy, setRegistrationBusy] = useState(false), [registrationError, setRegistrationError] = useState(null);
  const registrationAttempt = useRef({ sequence: 0, pending: false });
  const authInput = useRef(null);
  useEffect(() => { authInput.current?.focus(); }, [authMode]);
  useEffect(() => {
    const controller = new AbortController();
    api.request('/auth/me', { signal: controller.signal, notifyUnauthorized: false }).then(setUser).catch(e => {
      if (e.status !== 401 && e.name !== 'AbortError') setError(e);
    }).finally(() => setLoading(false));
    const expired = event => {
      setUser(null); setPassword(''); setError(event.detail);
      registrationAttempt.current.sequence++; registrationAttempt.current.pending = false;
      setRegistrationBusy(false); setRegistrationError(null); setRegistrationErrors({}); setRegistrationNotice('');
      setRegistration(current => ({ ...current, password: '', confirmPassword: '' })); setAuthMode('login');
    };
    window.addEventListener('portal-session-expired', expired);
    return () => { controller.abort(); registrationAttempt.current.sequence++; registrationAttempt.current.pending = false; window.removeEventListener('portal-session-expired', expired); };
  }, []);
  async function login(event) {
    event.preventDefault(); setBusy(true); setError(null); setRegistrationNotice('');
    try { setUser(await api.login(email.trim(), password)); } catch (e) { setError(e); }
    finally { setPassword(''); setBusy(false); }
  }
  async function logout() {
    setBusy(true); setError(null);
    try { await api.logout(); setUser(null); } catch (e) { setError(e); if (!api.csrf) setUser(null); }
    finally { setBusy(false); }
  }
  function switchAuthMode(mode) {
    if (busy || registrationAttempt.current.pending || mode === authMode) return;
    setPassword('');
    setRegistration(current => ({ ...current, password: '', confirmPassword: '' }));
    setRegistrationErrors({}); setRegistrationError(null); setRegistrationNotice(''); setError(null); setAuthMode(mode);
  }
  function updateRegistration(field, value) {
    setRegistration(current => ({ ...current, [field]: value }));
    setRegistrationErrors(current => {
      const next = { ...current }; delete next[field];
      if (field === 'password') delete next.confirmPassword;
      return next;
    });
    setRegistrationNotice(''); setRegistrationError(null);
  }
  async function register(event) {
    event.preventDefault();
    if (registrationAttempt.current.pending || busy || authMode !== 'register') return;
    const errors = {}, form = event.currentTarget;
    if (!registration.displayName.trim()) errors.displayName = 'Vui lòng nhập tên tài khoản.';
    else if ([...registration.displayName.trim()].length > 100) errors.displayName = 'Tên tài khoản tối đa 100 ký tự.';
    if (!registration.email.trim()) errors.email = 'Vui lòng nhập email.';
    else if (registration.email.length > 254) errors.email = 'Email tối đa 254 ký tự.';
    else if (form.elements.namedItem('email').validity.typeMismatch) errors.email = 'Email không hợp lệ.';
    if (!registration.password.trim()) errors.password = 'Vui lòng nhập mật khẩu.';
    else if ([...registration.password].length < 8) errors.password = 'Mật khẩu phải có tối thiểu 8 ký tự.';
    else if (new TextEncoder().encode(registration.password).length > 72) errors.password = 'Mật khẩu tối đa 72 byte UTF-8.';
    if (!registration.confirmPassword) errors.confirmPassword = 'Vui lòng nhập lại mật khẩu.';
    else if (registration.confirmPassword !== registration.password) errors.confirmPassword = 'Mật khẩu nhập lại không khớp.';
    setRegistrationErrors(errors); setRegistrationNotice(''); setRegistrationError(null);
    if (Object.keys(errors).length) { form.elements.namedItem(Object.keys(errors)[0])?.focus(); return; }
    const sequence = ++registrationAttempt.current.sequence;
    registrationAttempt.current.pending = true; setRegistrationBusy(true);
    try {
      const created = await api.register(registration);
      if (sequence !== registrationAttempt.current.sequence) return;
      setEmail(created.email); setPassword(''); setRegistrationErrors({}); setAuthMode('login');
      setRegistrationNotice('Đăng ký thành công! Vui lòng đăng nhập để tiếp tục.');
    } catch (failure) {
      if (sequence === registrationAttempt.current.sequence) setRegistrationError(failure);
    } finally {
      if (sequence === registrationAttempt.current.sequence) {
        registrationAttempt.current.pending = false; setRegistrationBusy(false);
        setRegistration(current => ({ ...current, password: '', confirmPassword: '' }));
      }
    }
  }
  if (!loading && user) return <Portal key={user.id} user={user} busy={busy} error={error} onLogout={logout} />;
  return <div className="container container--guest"><div className="guest-panel">
    <header className="guest-brand"><span className="brand-mark" aria-hidden="true">CH</span><h1>Cloud Handover</h1><p>Không gian tài liệu của nhóm</p></header>
    <ErrorNotice error={error} />
    {loading ? <LoadingState>Đang kiểm tra phiên đăng nhập…</LoadingState> : !user ? <Card>
      {authMode === 'login' ? <>
        <PageHeader title="Đăng nhập" description="Truy cập dự án và các gói bàn giao được cấp quyền." /><form key="login" onSubmit={login}>
          {registrationNotice && <p className="auth-registration-notice" role="status">{registrationNotice}</p>}
          <label>Email<input ref={authInput} type="email" name="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} /></label>
          <label>Mật khẩu<input type="password" name="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></label>
          <Button type="submit" disabled={busy}>{busy ? 'Đang đăng nhập…' : 'Đăng nhập'}</Button>
        </form>
      </> : <>
        <PageHeader title="Đăng ký" description="Tạo tài khoản Cloud Handover." />
        <form key="register" className="auth-register-form" noValidate onSubmit={register} aria-busy={registrationBusy}>
          {[
            { name: 'displayName', label: 'Tên tài khoản', type: 'text', autoComplete: 'name', maxLength: 100 },
            { name: 'email', label: 'Email', type: 'email', autoComplete: 'email', maxLength: 254 },
            { name: 'password', label: 'Mật khẩu', type: 'password', autoComplete: 'new-password', minLength: 8 },
            { name: 'confirmPassword', label: 'Nhập lại mật khẩu', type: 'password', autoComplete: 'new-password' },
          ].map(field => <div className="auth-field" key={field.name}>
            <label htmlFor={`register-${field.name}`}>{field.label}</label>
            <input id={`register-${field.name}`} ref={field.name === 'displayName' ? authInput : undefined}
              name={field.name} type={field.type} autoComplete={field.autoComplete} required disabled={registrationBusy}
              maxLength={field.maxLength} minLength={field.minLength} value={registration[field.name]}
              aria-invalid={!!registrationErrors[field.name]}
              aria-describedby={[field.name === 'password' && 'register-password-hint', registrationErrors[field.name] && `register-${field.name}-error`].filter(Boolean).join(' ') || undefined}
              onChange={e => updateRegistration(field.name, e.target.value)} />
            {field.name === 'password' && <p className="auth-field-hint" id="register-password-hint">Tối thiểu 8 ký tự, tối đa 72 byte UTF-8.</p>}
            {registrationErrors[field.name] && <p className="auth-field-error" id={`register-${field.name}-error`} role="alert">{registrationErrors[field.name]}</p>}
          </div>)}
          <ErrorNotice error={registrationError} />
          <Button type="submit" disabled={registrationBusy}>{registrationBusy ? 'Đang đăng ký…' : 'Đăng ký'}</Button>
        </form>
      </>}
      <p className="auth-mode-switch">{authMode === 'login' ? 'Chưa có tài khoản?' : 'Đã có tài khoản?'}
        <Button variant="secondary" type="button" disabled={busy || registrationBusy} onClick={() => switchAuthMode(authMode === 'login' ? 'register' : 'login')}>
          {authMode === 'login' ? 'Đăng ký' : 'Đăng nhập'}
        </Button>
      </p>
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
