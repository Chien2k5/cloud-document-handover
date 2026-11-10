import { useEffect, useRef, useState } from 'react';
import { api } from './client.js';
import { ApiError, segment } from './api.js';
import { canOwn, isUuid } from './rules.js';
import { Button, Card, EmptyState, ErrorNotice, LoadingState, PageHeader, Pager, ProjectSymbol, StatusBadge, TechnicalDetails } from './ui.jsx';
import Files from './Files.jsx';
import ProjectOverview from './ProjectOverview.jsx';
import { focusWorkspaceSection } from './navigation.js';

export default function Projects({ user, selected, onSelectProject, navigation, onHandoverCreated }) {
  const [page, setPage] = useState(0), [items, setItems] = useState([]), [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(true), [error, setError] = useState(null), [createError, setCreateError] = useState(null);
  const [name, setName] = useState(''), [description, setDescription] = useState(''), [creating, setCreating] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const createPanel = useRef(null), createButton = useRef(null), nameInput = useRef(null), submitting = useRef(false);
  useEffect(() => {
    const controller = new AbortController(); setBusy(true); setError(null);
    api.request(`/projects?page=${page}&size=20`, { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) setItems(data.items);
    }).catch(e => {
      if (e.name !== 'AbortError') { setError(e); setItems([]); }
    }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [page, reload]);
  useEffect(() => { if (navigation.view !== 'projects' && createPanel.current?.open) createPanel.current.close(); }, [navigation.view]);
  function openCreate() { createPanel.current.showModal(); nameInput.current.focus(); }
  function returnCreateFocus() { if (createButton.current?.getClientRects().length) createButton.current.focus(); }
  function cycleCreateFocus(event) {
    if (event.key !== 'Tab') return;
    const controls = [...createPanel.current.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled)')].filter(element => element.getClientRects().length);
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
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
      createPanel.current.close();
    } catch (e) { setCreateError(e); } finally { submitting.current = false; setCreating(false); }
  }
  return <>
    <Card className="workspace-section projects-page" id="workspace-projects" tabIndex={-1} hidden={navigation.view !== 'projects'} inert={navigation.view !== 'projects'}>
      <p className="eyebrow">Không gian làm việc</p>
      <PageHeader title="Dự án của bạn" description="Chọn dự án để quản lý tài liệu và bàn giao đúng phiên bản." actions={<>
        <Button variant="secondary" disabled={busy} onClick={() => setReload(value => value + 1)}>Tải lại dự án</Button>
        <Button ref={createButton} onClick={openCreate}>Tạo dự án mới</Button>
      </>} />
      <ErrorNotice error={error} />
      {busy ? <LoadingState>Đang tải dự án…</LoadingState> : !error && (items.length ? <ul className="project-list project-grid">{items.map(project => <li key={project.id}>
        <button className="project-tile" aria-label={`${project.name} · ${project.role}`} aria-pressed={selected === project.id} onClick={() => onSelectProject(project.id)}>
          <span className="project-tile__top"><ProjectSymbol /><StatusBadge>{project.role}</StatusBadge></span>
          <span className="project-tile__name">{project.name}</span>
          <span className="project-tile__description">{project.description || 'Chưa có mô tả.'}</span>
          <span className="project-tile__link">{selected === project.id ? 'Đang chọn' : 'Mở dự án'} <span aria-hidden="true">→</span></span>
        </button>
      </li>)}</ul> : <EmptyState title="Chưa có dự án ở trang này" description="Tạo dự án mới hoặc quay lại trang trước để tiếp tục." />)}
      <Pager page={page} count={items.length} busy={busy || !!error} onPage={setPage} />
      <dialog ref={createPanel} className="create-project" aria-labelledby="project-create-title" aria-describedby="project-create-help" onClose={returnCreateFocus} onKeyDown={cycleCreateFocus}>
        <div className="dialog-header"><h2 id="project-create-title">Tạo dự án</h2><Button variant="ghost" aria-label="Đóng form tạo dự án" onClick={() => createPanel.current.close()}>×</Button></div>
        <p id="project-create-help" className="muted">Đặt tên rõ ràng để các thành viên dễ nhận biết.</p>
        <ErrorNotice error={createError} />
        <form onSubmit={create}>
          <label htmlFor="project-name">Tên dự án</label><input id="project-name" ref={nameInput} required maxLength={150} value={name} aria-invalid={!!fieldErrors.name} aria-describedby="project-name-help project-name-error" onChange={event => { setName(event.target.value); setFieldErrors(value => ({ ...value, name: null })); }} />
          <span id="project-name-help" className="field-help">Tối đa 150 ký tự · {name.length}/150</span>
          {fieldErrors.name && <p id="project-name-error" className="field-error" role="alert">{fieldErrors.name}</p>}
          <label htmlFor="project-description">Mô tả</label><textarea id="project-description" maxLength={2000} value={description} aria-invalid={!!fieldErrors.description} aria-describedby="project-description-help project-description-error" onChange={event => { setDescription(event.target.value); setFieldErrors(value => ({ ...value, description: null })); }} />
          <span id="project-description-help" className="field-help">Không bắt buộc · {description.length}/2000 ký tự</span>
          {fieldErrors.description && <p id="project-description-error" className="field-error" role="alert">{fieldErrors.description}</p>}
          <div className="actions dialog-actions"><Button variant="secondary" onClick={() => createPanel.current.close()}>Để sau</Button><Button type="submit" disabled={creating}>{creating ? 'Đang tạo dự án…' : 'Tạo dự án'}</Button></div>
        </form>
      </dialog>
    </Card>
    <div hidden={navigation.view !== 'project'} inert={navigation.view !== 'project'}>{selected && <ProjectDetail key={selected} projectId={selected} user={user} navigation={navigation} onHandoverCreated={onHandoverCreated} />}</div>
  </>;
}

function ProjectDetail({ projectId, user, navigation, onHandoverCreated }) {
  const [project, setProject] = useState(null), [members, setMembers] = useState([]), [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(true), [error, setError] = useState(null);
  const [memberId, setMemberId] = useState(''), [role, setRole] = useState('VIEWER'), [saving, setSaving] = useState(false);
  const [removeTarget, setRemoveTarget] = useState(null);
  const memberMutation = useRef(null), memberInput = useRef(null), removeTrigger = useRef(null);
  const normalizedMember = memberId.trim();
  const ownerTarget = members.some(member => member.role === 'OWNER' && member.userId.toLowerCase() === normalizedMember.toLowerCase());
  const invalidMember = memberId.length > 0 && !isUuid(normalizedMember);
  useEffect(() => () => memberMutation.current?.abort(), []);
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
  function editMember(member) {
    if (saving || member.role === 'OWNER' || !canOwn(project)) return;
    setMemberId(member.userId); setRole(member.role); setRemoveTarget(null); memberInput.current?.focus();
  }
  async function changeMember(target, nextRole) {
    target = target.trim();
    if (memberMutation.current || !canOwn(project) || !isUuid(target)
        || members.some(member => member.role === 'OWNER' && member.userId.toLowerCase() === target.toLowerCase())
        || (nextRole !== undefined && !['EDITOR', 'VIEWER'].includes(nextRole))) return;
    const controller = new AbortController(); memberMutation.current = controller;
    setSaving(true); setError(null);
    try {
      await api.request(base + '/members/' + segment(target), nextRole ? { method: 'PUT', body: { role: nextRole }, signal: controller.signal } : { method: 'DELETE', signal: controller.signal });
      controller.signal.throwIfAborted(); setMemberId(''); setRemoveTarget(null); setReload(value => value + 1);
    } catch (e) {
      if (!controller.signal.aborted && e.name !== 'AbortError') {
        setError(e); if ([401, 403, 404].includes(e.status)) setProject(null);
      }
    } finally { if (memberMutation.current === controller) memberMutation.current = null; if (!controller.signal.aborted) setSaving(false); }
  }
  return <section className="card workspace-section" id="project-overview" tabIndex={-1}>
    <PageHeader title="Tổng quan dự án" actions={<Button variant="secondary" disabled={busy || saving} onClick={() => setReload(value => value + 1)}>Kiểm tra lại quyền dự án</Button>} /><ErrorNotice error={error} />
    {busy && <LoadingState>Đang tải quyền và thành viên…</LoadingState>}
    {project && <>
      <ProjectOverview project={project} />
      <div className="workspace-section members-section" id="project-members" tabIndex={-1}>
        <div className="section-heading"><div><h3>Thành viên</h3><p>Quyền truy cập được quản lý riêng cho dự án này.</p></div></div>
        {members.length === 0 ? <EmptyState title="Chưa có thành viên trong phản hồi" description="Kiểm tra lại quyền dự án để lấy danh sách mới từ máy chủ." /> : <ul className="member-list">{members.map(member => <li key={member.userId} className="member-row">
          <div className="member-row__identity"><div className="member-row__name"><strong>{member.displayName}</strong>{member.userId === user.id && <span className="self-badge">Bạn</span>}</div>
            <div className="member-row__role"><StatusBadge>{member.role}</StatusBadge>{member.role === 'OWNER' && <span className="field-help">Chủ dự án</span>}</div>
            <TechnicalDetails title="Thông tin kỹ thuật thành viên" accessibleLabel={`Thông tin kỹ thuật thành viên ${member.displayName}`}><p>UUID thành viên: <code>{member.userId}</code></p></TechnicalDetails>
          </div>
          {canOwn(project) && member.role !== 'OWNER' && <div className="actions member-row__actions">
            <Button variant="secondary" disabled={saving} aria-label={`Đổi vai trò ${member.displayName}`} onClick={() => editMember(member)}>Đổi vai trò</Button>
            <Button variant="danger" disabled={saving} aria-label={`Gỡ ${member.displayName}`} aria-expanded={removeTarget?.userId === member.userId} onClick={event => { removeTrigger.current = event.currentTarget; setRemoveTarget(member); }}>Gỡ</Button>
          </div>}
          {removeTarget?.userId === member.userId && <div className="member-confirm" role="group" aria-label={`Xác nhận gỡ ${member.displayName}`}>
            <p>Gỡ <strong>{member.displayName}</strong> khỏi dự án? Thành viên sẽ mất quyền truy cập dự án này.</p>
            <div className="actions"><Button autoFocus variant="secondary" disabled={saving} onClick={() => { setRemoveTarget(null); removeTrigger.current?.focus(); }}>Hủy gỡ thành viên</Button>
              <Button variant="danger" disabled={saving} onClick={() => changeMember(member.userId)}>Xác nhận gỡ {member.displayName}</Button></div>
          </div>}
        </li>)}</ul>}
      {canOwn(project) && <div className="member-form-panel"><h4>Thêm hoặc cập nhật thành viên</h4>
        <p className="muted">Dùng UUID của tài khoản đang hoạt động. Chọn thành viên trong danh sách để đổi vai trò; quyền cuối cùng do máy chủ xác minh.</p>
        <form onSubmit={event => { event.preventDefault(); if (isUuid(normalizedMember) && !ownerTarget) changeMember(normalizedMember, role); }}>
          <label htmlFor="member-uuid">UUID thành viên</label><input id="member-uuid" ref={memberInput} required disabled={saving} value={memberId} pattern={'\\s*[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\\s*'} aria-invalid={invalidMember || ownerTarget} aria-describedby="member-uuid-help member-uuid-error" onChange={event => setMemberId(event.target.value)} />
          <span className="field-help" id="member-uuid-help">UUID gồm 5 nhóm ký tự hex, ví dụ 8-4-4-4-12. Khoảng trắng ở đầu/cuối được bỏ khi gửi.</span>
          {(invalidMember || ownerTarget) && <p className="field-error" id="member-uuid-error" role="alert">{ownerTarget ? 'Không thể thay đổi OWNER của dự án.' : 'UUID không đúng định dạng. Kiểm tra đủ 5 nhóm và dấu gạch nối.'}</p>}
          <label htmlFor="member-role">Vai trò thành viên</label><select id="member-role" disabled={saving} value={role} onChange={event => setRole(event.target.value)}><option value="VIEWER">VIEWER</option><option value="EDITOR">EDITOR</option></select>
          <p className="field-help">EDITOR có thể tải lên; VIEWER chỉ xem và tải phiên bản được phép.</p>
          <div className="actions"><Button type="submit" disabled={saving || !isUuid(normalizedMember) || ownerTarget}>Lưu thành viên</Button></div>
          {saving && <p role="status">Đang xử lý thay đổi thành viên…</p>}
        </form>
      </div>}</div>
      <div className="workspace-section" id="project-files" tabIndex={-1}><Files project={project} members={members} onHandoverCreated={onHandoverCreated} /></div>
    </>}
  </section>;
}
