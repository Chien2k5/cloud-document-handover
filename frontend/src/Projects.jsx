import { useEffect, useState } from 'react';
import { api } from './client.js';
import { segment } from './api.js';
import { canOwn, isUuid } from './rules.js';
import { ErrorNotice, Pager } from './ui.jsx';
import Files from './Files.jsx';

export default function Projects({ user }) {
  const [page, setPage] = useState(0), [items, setItems] = useState([]), [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false), [error, setError] = useState(null), [selected, setSelected] = useState(null);
  const [name, setName] = useState(''), [description, setDescription] = useState(''), [creating, setCreating] = useState(false);
  useEffect(() => {
    const controller = new AbortController(); setBusy(true); setError(null);
    api.request(`/projects?page=${page}&size=20`, { signal: controller.signal }).then(data => setItems(data.items)).catch(e => {
      if (e.name !== 'AbortError') { setError(e); setItems([]); }
    }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [page, reload]);
  async function create(event) {
    event.preventDefault(); setCreating(true); setError(null);
    try {
      const project = await api.request('/projects', { method: 'POST', body: { name: name.trim(), description: description.trim() } });
      setSelected(project.id); setName(''); setDescription(''); setPage(0); setReload(value => value + 1);
    } catch (e) { setError(e); } finally { setCreating(false); }
  }
  return <>
    <section className="card"><h2>Dự án của bạn</h2><ErrorNotice error={error} />
      <button disabled={busy} onClick={() => setReload(value => value + 1)}>Tải lại dự án</button>
      {busy ? <p role="status">Đang tải dự án…</p> : <ul className="project-list">{items.map(project => <li key={project.id}><button aria-pressed={selected === project.id} onClick={() => setSelected(project.id)}>{project.name} · {project.role}</button></li>)}</ul>}
      {!busy && items.length === 0 && <p>Không có dự án ở trang này.</p>}
      <Pager page={page} count={items.length} busy={busy} onPage={setPage} />
      <details><summary>Tạo dự án mới</summary><form onSubmit={create}>
        <label>Tên dự án<input required maxLength={150} value={name} onChange={event => setName(event.target.value)} /></label>
        <label>Mô tả<textarea maxLength={2000} value={description} onChange={event => setDescription(event.target.value)} /></label>
        <button disabled={creating}>Tạo dự án</button>
      </form></details>
    </section>
    {selected && <ProjectDetail key={selected} projectId={selected} user={user} />}
  </>;
}

function ProjectDetail({ projectId, user }) {
  const [project, setProject] = useState(null), [members, setMembers] = useState([]), [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(true), [error, setError] = useState(null);
  const [memberId, setMemberId] = useState(''), [role, setRole] = useState('VIEWER'), [saving, setSaving] = useState(false);
  const base = `/projects/${segment(projectId)}`;
  useEffect(() => {
    const controller = new AbortController(); setBusy(true); setError(null); setProject(null);
    Promise.all([api.request(base, { signal: controller.signal }), api.request(base + '/members', { signal: controller.signal })])
      .then(([detail, people]) => { setProject(detail); setMembers(people); })
      .catch(e => { if (e.name !== 'AbortError') setError(e); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [base, reload]);
  async function changeMember(target, nextRole) {
    setSaving(true); setError(null);
    try {
      await api.request(base + '/members/' + segment(target), nextRole ? { method: 'PUT', body: { role: nextRole } } : { method: 'DELETE' });
      setMemberId(''); setReload(value => value + 1);
    } catch (e) {
      setError(e);
      if ([401, 403, 404].includes(e.status)) setProject(null);
    } finally { setSaving(false); }
  }
  return <section className="card"><h2>Chi tiết dự án</h2><ErrorNotice error={error} />
    <button disabled={busy} onClick={() => setReload(value => value + 1)}>Kiểm tra lại quyền dự án</button>
    {busy && <p role="status">Đang tải quyền và thành viên…</p>}
    {project && <>
      <h3>{project.name}</h3><p>{project.description}</p><p>Vai trò: <strong>{project.role}</strong></p>
      <p>Project ID: <code>{project.id}</code></p><p>Quota: {project.usedBytes} đã dùng + {project.reservedBytes} đang giữ / {project.quotaBytes} byte.</p>
      <h3>Thành viên</h3><ul>{members.map(member => <li key={member.userId}>{member.displayName} · {member.role} · <code>{member.userId}</code>{member.userId === user.id && ' (bạn)'}{' '}
        {canOwn(project) && member.role !== 'OWNER' && <button disabled={saving} onClick={() => changeMember(member.userId)}>Gỡ {member.displayName}</button>}</li>)}</ul>
      {canOwn(project) && <form onSubmit={event => { event.preventDefault(); if (isUuid(memberId.trim())) changeMember(memberId.trim(), role); }}>
        <label>UUID thành viên<input required value={memberId} pattern="[0-9a-fA-F-]{36}" onChange={event => setMemberId(event.target.value)} /></label>
        <label>Vai trò thành viên<select aria-label="Vai trò thành viên" value={role} onChange={event => setRole(event.target.value)}><option value="VIEWER">VIEWER</option><option value="EDITOR">EDITOR</option></select></label>
        <button disabled={saving || !isUuid(memberId.trim())}>Lưu thành viên</button>
      </form>}
      <Files project={project} />
    </>}
  </section>;
}
