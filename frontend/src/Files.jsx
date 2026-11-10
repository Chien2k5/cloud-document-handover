import { useEffect, useRef, useState } from 'react';
import { api } from './client.js';
import { segment } from './api.js';
import { canOwn, canWrite, isVerified } from './rules.js';
import { downloadUrl, updateVersion } from './files.js';
import { pollUpload, shouldPoll } from './upload.js';
import { ErrorNotice, Pager } from './ui.jsx';
import UploadPanel, { VersionState } from './UploadPanel.jsx';
import { CreateHandover } from './Handovers.jsx';

export default function Files({ project, members, onHandoverCreated }) {
  const [page, setPage] = useState(0), [items, setItems] = useState([]), [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false), [error, setError] = useState(null), [polling, setPolling] = useState(false);
  const [target, setTarget] = useState(null), [download, setDownload] = useState(null), [actionBusy, setActionBusy] = useState(false);
  const manual = useRef(null);
  const [selected, setSelected] = useState({});
  function reconcileSelection(versions) {
    setSelected(current => {
      const next = { ...current };
      for (const version of versions) if (next[version.id]) { if (isVerified(version)) next[version.id] = version; else delete next[version.id]; }
      return next;
    });
  }
  const base = `/projects/${segment(project.id)}/files`;
  const refresh = () => setReload(value => value + 1);
  useEffect(() => () => manual.current?.abort(), []);
  useEffect(() => {
    const controller = new AbortController(); let timer, disposed = false;
    setBusy(true); setError(null); setDownload(null); setPolling(false); setItems([]);
    (async () => {
      const data = await api.request(`${base}?page=${page}&size=20`, { signal: controller.signal });
      controller.signal.throwIfAborted(); setItems(data.items); reconcileSelection(data.items); setBusy(false);
      const pending = data.items.filter(shouldPoll); if (!pending.length) return;
      setPolling(true); timer = setTimeout(() => controller.abort(), 60000);
      // At most three independent versions in flight; each poll has at most 15 reads.
      let next = 0;
      await Promise.all(Array.from({ length: Math.min(3, pending.length) }, async () => {
        while (next < pending.length) {
          const file = pending[next++];
          await pollUpload(api, project.id, file.uploadId, { signal: controller.signal,
            onState: state => { setItems(current => updateVersion(current, state.fileVersion)); reconcileSelection([state.fileVersion]); } });
        }
      }));
    })().catch(e => { if (e.name !== 'AbortError') { setError(e); controller.abort(); } })
      .finally(() => { clearTimeout(timer); if (!disposed) { setBusy(false); setPolling(false); } });
    return () => { disposed = true; clearTimeout(timer); controller.abort(); };
  }, [base, page, reload, project.id]);
  async function check(file) {
    const controller = new AbortController(); manual.current = controller; setActionBusy(true); setError(null);
    try {
      const state = await api.request(`${base}/uploads/${segment(file.uploadId)}`, { signal: controller.signal });
      controller.signal.throwIfAborted(); setItems(current => updateVersion(current, state.fileVersion)); reconcileSelection([state.fileVersion]);
    } catch (e) { if (e.name !== 'AbortError') setError(e); }
    finally { manual.current = null; setActionBusy(false); }
  }
  async function prepareDownload(file) {
    const controller = new AbortController(); manual.current = controller; setActionBusy(true); setError(null); setDownload(null);
    try {
      const result = await api.request(`${base}/${segment(file.id)}/download`, { signal: controller.signal });
      controller.signal.throwIfAborted(); setDownload({ id: file.id, url: downloadUrl(result), expiresAt: result.expiresAt });
    } catch (e) { if (e.name !== 'AbortError') setError(e); }
    finally { manual.current = null; setActionBusy(false); }
  }
  return <>
    <UploadPanel project={project} targetFile={target} onChanged={refresh} onUploaded={() => setTarget(null)} />
    {target && <button onClick={() => setTarget(null)}>Chọn tài liệu mới thay vì thêm phiên bản</button>}
    <section className="card"><h3>File và phiên bản</h3><ErrorNotice error={error} />
      <button disabled={busy || actionBusy} onClick={refresh}>Tải lại danh sách file</button>
      {busy && <p role="status">Đang tải file…</p>}
      {polling && <p role="status">Đang đối soát phiên bản chờ bằng Upload ID; tự dừng sau tối đa 60 giây.</p>}
      {!busy && items.length === 0 && <p>Chưa có file ở trang này.</p>}
      <ul className="file-list">{items.map(file => <li key={file.id} className="file-card">
        <h4>{file.filename} · {file.size} byte</h4><p>File ID: <code>{file.fileId}</code></p>
        <p>FileVersion ID: <code>{file.id}</code></p><p>Upload ID: <code>{file.uploadId}</code></p><p>S3 Version ID: <code>{file.versionId || 'Chưa complete'}</code></p>
        <VersionState file={file} />
        {canOwn(project) && <label className="select-file"><input type="checkbox" checked={Boolean(selected[file.id])} disabled={!isVerified(file)} onChange={event => setSelected(current => { const next = { ...current }; if (event.target.checked) next[file.id] = file; else delete next[file.id]; return next; })} />Chọn bàn giao {file.filename} · {file.id}</label>}
        <div className="actions"><button disabled={actionBusy} onClick={() => check(file)}>Kiểm tra lại {file.filename}</button>
          <button disabled={actionBusy || !isVerified(file)} onClick={() => prepareDownload(file)}>Lấy link tải {file.filename}</button>
          {canWrite(project) && <button disabled={actionBusy} onClick={() => setTarget(file)}>Thêm phiên bản {file.filename}</button>}
        </div>
        {download?.id === file.id && <p><a href={download.url} target="_blank" rel="noopener noreferrer">Tải phiên bản đã chọn</a> · Hết hạn {new Date(download.expiresAt).toLocaleString('vi-VN')}</p>}
      </li>)}</ul>
      <Pager page={page} count={items.length} busy={busy || actionBusy} onPage={setPage} />
    </section>
    <CreateHandover project={project} members={members} files={Object.values(selected)} onCreated={onHandoverCreated} />
  </>;
}
