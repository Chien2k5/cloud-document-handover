import { useEffect, useRef, useState } from 'react';
import { api } from './client.js';
import { ApiError, segment } from './api.js';
import { canOwn, isUuid } from './rules.js';
import { createHandoverBody, handoverPermissions } from './handover.js';
import { downloadUrl } from './files.js';
import { ErrorNotice } from './ui.jsx';

export function CreateHandover({ project, members, files, onCreated }) {
  const [title, setTitle] = useState(''), [recipients, setRecipients] = useState(''), [expiresAt, setExpiresAt] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(null), [created, setCreated] = useState(null);
  const active = useRef(null); useEffect(() => () => active.current?.abort(), []);
  if (!canOwn(project)) return null;
  async function submit(event) {
    event.preventDefault(); setError(null); setBusy(true);
    const controller = new AbortController(); active.current = controller;
    try {
      const body = createHandoverBody({ title, files, recipients, expiresAt });
      const result = await api.request(`/projects/${segment(project.id)}/handovers`, { method: 'POST', body, signal: controller.signal });
      controller.signal.throwIfAborted(); setCreated(result.id); onCreated(result.id);
    } catch (e) { if (e.name !== 'AbortError') setError(e); }
    finally { active.current = null; setBusy(false); }
  }
  return <section className="card"><h3>Tạo gói DRAFT</h3><ErrorNotice error={error} />
    <p>Đã chọn {files.length} phiên bản AVAILABLE + VERIFIED. Giữ nguyên version ngay cả khi có bản upload mới.</p>
    <form onSubmit={submit}><fieldset disabled={busy}>
      <label>Tiêu đề bàn giao<input required maxLength={200} value={title} onChange={event => setTitle(event.target.value)} /></label>
      <label>UUID người nhận<textarea required value={recipients} onChange={event => setRecipients(event.target.value)} placeholder="Một hoặc nhiều UUID, ngăn bằng dấu phẩy" /></label>
      <details><summary>Thành viên có thể chọn làm người nhận</summary><ul>{members.map(member => <li key={member.userId}>{member.displayName} · <code>{member.userId}</code>{' '}<button type="button" onClick={() => setRecipients(value => value ? value + ', ' + member.userId : member.userId)}>Thêm người nhận {member.displayName}</button></li>)}</ul></details>
      <p>Có thể nhập UUID tài khoản enabled ngoài dự án; backend kiểm tra tài khoản. Không có API tìm toàn bộ người dùng.</p>
      <label>Hạn bàn giao (giờ trên máy bạn)<input type="datetime-local" required value={expiresAt} onChange={event => setExpiresAt(event.target.value)} /></label>
      <button disabled={!files.length}>Tạo DRAFT</button>
    </fieldset></form>
    {created && <p>Đã tạo gói <code>{created}</code>. Xem trạng thái ở mục gói bàn giao bên dưới.</p>}
  </section>;
}

export default function Handovers({ user, activeId, onSelect }) {
  const [entry, setEntry] = useState(activeId || ''), [reload, setReload] = useState(0);
  useEffect(() => setEntry(activeId || ''), [activeId]);
  return <section className="card workspace-section" id="workspace-handovers" tabIndex={-1}><h2>Gói bàn giao</h2>
    <p>Mở gói bằng UUID được Owner cung cấp. Người nhận ngoài dự án cũng dùng mục này.</p>
    <form onSubmit={event => { event.preventDefault(); if (isUuid(entry.trim())) { onSelect(entry.trim()); setReload(value => value + 1); } }}>
      <label>UUID gói bàn giao<input required value={entry} onChange={event => setEntry(event.target.value)} /></label>
      <button disabled={!isUuid(entry.trim())}>Mở gói bàn giao</button>
    </form>
    {activeId && <HandoverView key={`${activeId}-${reload}`} id={activeId} user={user} />}
  </section>;
}

function HandoverView({ id, user }) {
  const [handover, setHandover] = useState(null), [project, setProject] = useState(null);
  const [error, setError] = useState(null), [busy, setBusy] = useState(true), [now, setNow] = useState(Date.now());
  const [download, setDownload] = useState(null); const active = useRef(null);
  const base = `/handovers/${segment(id)}`;
  async function read(signal) {
    const data = await api.request(base, { signal }); signal.throwIfAborted(); setHandover(data); setProject(null); setDownload(null);
    try {
      const detail = await api.request(`/projects/${segment(data.projectId)}`, { signal }); signal.throwIfAborted(); setProject(detail);
    } catch (e) { if (![403, 404].includes(e.status)) throw e; }
  }
  useEffect(() => {
    const controller = new AbortController(); active.current = controller;
    read(controller.signal).catch(e => { if (e.name !== 'AbortError') setError(e); }).finally(() => { if (!controller.signal.aborted) { setBusy(false); active.current = null; } });
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(clock); controller.abort(); active.current?.abort(); };
  }, [base]); // Component is keyed by immutable handover ID and account parent.
  async function action(kind, itemId) {
    if (active.current) return;
    const controller = new AbortController(); active.current = controller; setBusy(true); setError(null); setDownload(null);
    try {
      if (kind === 'download') {
        const result = await api.request(`${base}/items/${segment(itemId)}/download`, { signal: controller.signal });
        if (result.versionId !== handover.items.find(item => item.fileVersionId === itemId)?.versionId) throw new ApiError(0, 'INVALID_DOWNLOAD');
        controller.signal.throwIfAborted(); setDownload({ itemId, url: downloadUrl(result), expiresAt: result.expiresAt });
      } else {
        if (kind !== 'refresh') await api.request(`${base}/${kind}`, { method: 'POST', signal: controller.signal });
        // Confirmation response describes one recipient, never infer aggregate CONFIRMED.
        await read(controller.signal);
      }
    } catch (e) { if (e.name !== 'AbortError') { setError(e); if ([401, 403, 404].includes(e.status)) { setHandover(null); setProject(null); } } }
    finally { active.current = null; setBusy(false); }
  }
  const permissions = handoverPermissions(handover, project, user.id, now);
  return <div className="handover"><ErrorNotice error={error} /><button disabled={busy} onClick={() => action('refresh')}>Tải lại gói</button>
    {busy && <p role="status">Đang kiểm tra gói và quyền hiện tại…</p>}
    {handover && <><h3>{handover.title}</h3><p>Handover ID: <code>{handover.id}</code></p>
      <p>Workflow: <strong>{handover.status}</strong> · Access: <strong>{handover.accessStatus}</strong> · {permissions.expired ? 'Expired — đã hết hạn' : 'Chưa hết hạn'}</p>
      <p>Hạn: {new Date(handover.expiresAt).toLocaleString('vi-VN')}</p>
      <div className="actions">{permissions.publish && <button disabled={busy} onClick={() => action('publish')}>Phát hành gói</button>}
        {permissions.confirm && <button disabled={busy} onClick={() => action('confirm')}>Xác nhận nhận bàn giao</button>}
        {permissions.revoke && <button disabled={busy} onClick={() => action('revoke')}>Thu hồi gói</button>}</div>
      <h4>Phiên bản trong gói</h4><ul>{handover.items.map(item => <li key={item.fileVersionId}>{item.filename} · FileVersion ID: <code>{item.fileVersionId}</code> · S3 Version ID: <code>{item.versionId}</code>{' '}
        <button disabled={busy || !permissions.download} onClick={() => action('download', item.fileVersionId)}>Lấy link tải item {item.filename}</button>
        {download?.itemId === item.fileVersionId && permissions.download && Date.parse(download.expiresAt) > now && <p><a href={download.url} target="_blank" rel="noopener noreferrer">Tải item đúng phiên bản</a></p>}</li>)}</ul>
      <h4>Người nhận</h4><ul>{handover.recipients.map(person => <li key={person.userId}><code>{person.userId}</code> · {person.accessStatus} · {person.confirmedAt ? `Đã xác nhận ${new Date(person.confirmedAt).toLocaleString('vi-VN')}` : 'Chưa xác nhận'}</li>)}</ul>
      <p>Thu hồi/hết hạn chặn cấp URL mới. URL đã cấp trước đó có thể còn dùng được tới hạn của URL.</p>
    </>}
  </div>;
}
