import { useEffect, useState } from 'react';
import { api } from './client.js';
import { ErrorNotice } from './ui.jsx';
import Projects from './Projects.jsx';
export default function App() {
  const [user, setUser] = useState(null), [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false), [error, setError] = useState(null);
  const [email, setEmail] = useState(''), [password, setPassword] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    api.request('/auth/me', { signal: controller.signal }).then(setUser).catch(e => {
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
  return <div className="container">
    <header><h1>Portal tài liệu nhóm 5</h1><div>{user ? <><span>{user.displayName} · {user.email}</span> <button disabled={busy} onClick={logout}>Đăng xuất</button></> : 'Chưa đăng nhập'}</div></header>
    <ErrorNotice error={error} />
    {loading ? <p role="status">Đang kiểm tra phiên đăng nhập…</p> : !user ? <section className="card">
      <h2>Đăng nhập</h2><form onSubmit={login}>
        <label>Email<input type="email" name="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} /></label>
        <label>Mật khẩu<input type="password" name="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></label>
        <button disabled={busy}>{busy ? 'Đang đăng nhập…' : 'Đăng nhập'}</button>
      </form>
    </section> : <main key={user.id}><Projects user={user} /></main>}
  </div>;
}
