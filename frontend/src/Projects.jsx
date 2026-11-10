import { useEffect, useRef, useState } from 'react';
import { api } from './client.js';
import { ApiError, segment } from './api.js';
import { canOwn, isUuid } from './rules.js';
import { Button, Card, EmptyState, ErrorNotice, LoadingState, PageHeader, Pager, StatusBadge } from './ui.jsx';
import Files from './Files.jsx';
import ProjectOverview from './ProjectOverview.jsx';
import { focusWorkspaceSection } from './navigation.js';

export default function Projects({ user, selected, onSelectProject, navigation, onHandoverCreated }) {
  const [page, setPage] = useState(0), [items, setItems] = useState([]), [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(true), [error, setError] = useState(null), [createError, setCreateError] = useState(null);
  const [name, setName] = useState(''), [description, setDescription] = useState(''), [creating, setCreating] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const createPanel = useRef(null), nameInput = useRef(null), submitting = useRef(false);
  useEffect(() => {
    const controller = new AbortController(); setBusy(true); setError(null);
    api.request(`/projects?page=${page}&size=20`, { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) setItems(data.items);
    }).catch(e => {
      if (e.name !== 'AbortError') { setError(e); setItems([]); }
    }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [page, reload]);
  function openCreate() { createPanel.current.open = true; nameInput.current.focus(); }
  async function create(event) {
    event.preventDefault();
    if (submitting.current) return;
    const invalid = {};
    if (!name.trim()) invalid.name = 'Nhập tên dự án, không chỉ khoảng trắng.';
    else if (name.length > 150) invalid.name = 'Tên dự án tối đa 150 ký tự.';
    if (description.length > 2000) invalid.description = 'Mô tả tối đa 2000 ký tự.';
    setFieldErrors(invalid);
    if (Object.keys(invalid).length) { if (invalid.name) nameInput.current.focus(); return; }
    submitting.current = true; setCreating(true); setCreateError(null);
    try {
      const project = await api.request('/projects', { method: 'POST', body: { name: name.trim(), description: description.trim() } });
      if (!isUuid(project?.id)) throw new ApiError(0, 'INVALID_RESPONSE');
      onSelectProject(project.id); setName(''); setDescription(''); setPage(0); setReload(value => value + 1);
      createPanel.current.open = false;
    } catch (e) { setCreateError(e); } finally { submitting.current = false; setCreating(false); }
  }
  return <>
    <Card className="workspace-section projects-page" id="workspace-projects" tabIndex={-1}>
      <p className="eyebrow">Không gian làm việc</p>
      <PageHeader title="Dự án của bạn" description="Chọn dự án để quản lý tài liệu và bàn giao đúng phiên bản." actions={<>
        <Button variant="secondary" disabled={busy} onClick={() => setReload(value => value + 1)}>Tải lại dự án</Button>
        <Button onClick={openCreate}>Tạo dự án mới</Button>
      </>} />
      <ErrorNotice error={error} />
      {busy ? <LoadingState>Đang tải dự án…</LoadingState> : !error && (items.length ? <ul className="project-list project-grid">{items.map(project => <li key={project.id}>
        <button className="project-tile" aria-label={`${project.name} · ${project.role}`} aria-pressed={selected === project.id} onClick={() => onSelectProject(project.id)}>
          <span className="project-tile__top"><span className="project-symbol" aria-hidden="true">▱</span><StatusBadge>{project.role}</StatusBadge></span>
          <span className="project-tile__name">{project.name}</span>
          <span className="project-tile__description">{project.description || 'Chưa có mô tả.'}</span>
          <span className="project-tile__link">{selected === project.id ? 'Đang chọn' : 'Mở dự án'} <span aria-hidden="true">→</span></span>
        </button>
      </li>)}</ul> : <EmptyState title="Chưa có dự án ở trang này" description="Tạo dự án mới hoặc quay lại trang trước để tiếp tục." />)}
      <Pager page={page} count={items.length} busy={busy || !!error} onPage={setPage} />
      <details ref={createPanel} className="create-project"><summary>Thông tin dự án mới</summary>
        <p className="muted">Đặt tên rõ ràng để các thành viên dễ nhận biết.</p>
        <ErrorNotice error={createError} />
        <form onSubmit={create}>
          <label htmlFor="project-name">Tên dự án</label><input id="project-name" ref={nameInput} required maxLength={150} value={name} aria-invalid={!!fieldErrors.name} aria-describedby="project-name-help project-name-error" onChange={event => { setName(event.target.value); setFieldErrors(value => ({ ...value, name: null })); }} />
          <span id="project-name-help" className="field-help">Tối đa 150 ký tự · {name.length}/150</span>
          {fieldErrors.name && <p id="project-name-error" className="field-error" role="alert">{fieldErrors.name}</p>}
          <label htmlFor="project-description">Mô tả</label><textarea id="project-description" maxLength={2000} value={description} aria-invalid={!!fieldErrors.description} aria-describedby="project-description-help project-description-error" onChange={event => { setDescription(event.target.value); setFieldErrors(value => ({ ...value, description: null })); }} />
          <span id="project-description-help" className="field-help">Không bắt buộc · {description.length}/2000 ký tự</span>
          {fieldErrors.description && <p id="project-description-error" className="field-error" role="alert">{fieldErrors.description}</p>}
          <div className="actions"><Button type="submit" disabled={creating}>{creating ? 'Đang tạo dự án…' : 'Tạo dự án'}</Button></div>
        </form>
      </details>
    </Card>
    {selected && <ProjectDetail key={selected} projectId={selected} user={user} navigation={navigation} onHandoverCreated={onHandoverCreated} />}
  </>;
}

function ProjectDetail({ projectId, user, navigation, onHandoverCreated }) {
  const [project, setProject] = useState(null), [members, setMembers] = useState([]), [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(true), [error, setError] = useState(null);
  const [memberId, setMemberId] = useState(''), [role, setRole] = useState('VIEWER'), [saving, setSaving] = useState(false);
  const base = `/projects/${segment(projectId)}`;
  useEffect(() => {
    if (project && !busy && navigation?.view === 'project') focusWorkspaceSection(`project-${navigation.section}`);
  }, [project, busy, navigation]);
  useEffect(() => {
    const controller = new AbortController(); setBusy(true); setError(null); setProject(null);
    Promise.all([api.request(base, { signal: controller.signal }), api.request(base + '/members', { signal: controller.signal })])
      .then(([detail, people]) => { if (!controller.signal.aborted) { setProject(detail); setMembers(people); } })
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
  return <section className="card workspace-section" id="project-overview" tabIndex={-1}>
    <PageHeader title="Tổng quan dự án" actions={<Button variant="secondary" disabled={busy} onClick={() => setReload(value => value + 1)}>Kiểm tra lại quyền dự án</Button>} /><ErrorNotice error={error} />
    {busy && <LoadingState>Đang tải quyền và thành viên…</LoadingState>}
    {project && <>
      <ProjectOverview project={project} />
      <div className="workspace-section" id="project-members" tabIndex={-1}><h3>Thành viên</h3><ul>{members.map(member => <li key={member.userId}>{member.displayName} · {member.role} · <code>{member.userId}</code>{member.userId === user.id && ' (bạn)'}{' '}
        {canOwn(project) && member.role !== 'OWNER' && <button disabled={saving} onClick={() => changeMember(member.userId)}>Gỡ {member.displayName}</button>}</li>)}</ul>
      {canOwn(project) && <form onSubmit={event => { event.preventDefault(); if (isUuid(memberId.trim())) changeMember(memberId.trim(), role); }}>
        <label>UUID thành viên<input required value={memberId} pattern="[0-9a-fA-F-]{36}" onChange={event => setMemberId(event.target.value)} /></label>
        <label>Vai trò thành viên<select aria-label="Vai trò thành viên" value={role} onChange={event => setRole(event.target.value)}><option value="VIEWER">VIEWER</option><option value="EDITOR">EDITOR</option></select></label>
        <button disabled={saving || !isUuid(memberId.trim())}>Lưu thành viên</button>
      </form>}</div>
      <div className="workspace-section" id="project-files" tabIndex={-1}><Files project={project} members={members} onHandoverCreated={onHandoverCreated} /></div>
    </>}
  </section>;
}
