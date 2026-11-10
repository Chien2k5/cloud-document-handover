import { useEffect, useRef, useState } from 'react';
import { api } from './client.js';
import { ApiError, segment } from './api.js';
import { canOwn, canWrite, isVerified } from './rules.js';
import { downloadUrl, updateVersion } from './files.js';
import { pollUpload, shouldPoll } from './upload.js';
import { Button, EmptyState, ErrorNotice, LoadingState, Pager } from './ui.jsx';
import UploadPanel from './UploadPanel.jsx';
import { FileVersionDetails, FileVersionStatus } from './FileVersionInfo.jsx';
import ExpiringDownloadLink from './ExpiringDownloadLink.jsx';
import { CreateHandover } from './Handovers.jsx';

export default function Files({ project, members, onHandoverCreated, onAccessLost }) {
  const [page, setPage] = useState(0), [items, setItems] = useState([]), [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false), [error, setError] = useState(null), [polling, setPolling] = useState(false);
  const [target, setTarget] = useState(null), [download, setDownload] = useState(null), [actionBusy, setActionBusy] = useState(false);
  const manual = useRef(null);
  const accessLost = useRef(onAccessLost);
  useEffect(() => { accessLost.current = onAccessLost; }, [onAccessLost]);
  const [selected, setSelected] = useState({});
  const [uploadBusy, setUploadBusy] = useState(false);
  function reconcileSelection(versions) {
    setSelected(current => {
      const next = { ...current };
      for (const version of versions) if (next[version.id]) { if (isVerified(version)) next[version.id] = version; else delete next[version.id]; }
      return next;
    });
  }
  const base = `/projects/${segment(project.id)}/files`;
  const refresh = () => setReload(value => value + 1);
  function showError(e) {
    setError(e);
    if ([401, 403, 404].includes(e.status)) {
      setItems([]); setSelected({}); setDownload(null); accessLost.current?.(e);
    }
  }
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
    })().catch(e => { if (!controller.signal.aborted && e.name !== 'AbortError') { showError(e); controller.abort(); } })
      .finally(() => { clearTimeout(timer); if (!disposed) { setBusy(false); setPolling(false); } });
    return () => { disposed = true; clearTimeout(timer); controller.abort(); };
  }, [base, page, reload, project.id]);
  async function check(file) {
    if (manual.current) return;
    const controller = new AbortController(); manual.current = controller; setActionBusy(true); setError(null); setDownload(null);
    try {
      const state = await api.request(`${base}/uploads/${segment(file.uploadId)}`, { signal: controller.signal });
      controller.signal.throwIfAborted(); setItems(current => updateVersion(current, state.fileVersion)); reconcileSelection([state.fileVersion]);
    } catch (e) { if (!controller.signal.aborted && e.name !== 'AbortError') showError(e); }
    finally { if (manual.current === controller) manual.current = null; if (!controller.signal.aborted) setActionBusy(false); }
  }
  async function prepareDownload(file) {
    if (manual.current) return;
    const controller = new AbortController(); manual.current = controller; setActionBusy(true); setError(null); setDownload(null);
    try {
      const result = await api.request(`${base}/${segment(file.id)}/download`, { signal: controller.signal });
      if (result.versionId !== file.versionId) throw new ApiError(0, 'INVALID_DOWNLOAD');
      controller.signal.throwIfAborted(); setDownload({ id: file.id, url: downloadUrl(result), expiresAt: result.expiresAt });
    } catch (e) { if (!controller.signal.aborted && e.name !== 'AbortError') showError(e); }
    finally { if (manual.current === controller) manual.current = null; if (!controller.signal.aborted) setActionBusy(false); }
  }
  return <>
    <UploadPanel project={project} targetFile={target} onChanged={refresh} onUploaded={() => setTarget(null)} onBusyChange={setUploadBusy} onAccessLost={showError} />
    {target && <button disabled={uploadBusy} onClick={() => setTarget(null)}>Chọn tài liệu mới thay vì thêm phiên bản</button>}
    <section className="card files-section">
      <div className="section-heading"><div><h3>File và phiên bản</h3><p>Mỗi thẻ là một FileVersion. Mở thông tin kỹ thuật để đối chiếu định danh trước khi chọn bàn giao.</p></div><Button variant="secondary" disabled={busy || actionBusy} onClick={refresh}>Tải lại danh sách file</Button></div>
      <ErrorNotice error={error} />
      {busy && <LoadingState>Đang tải file…</LoadingState>}
      {polling && <p className="file-polling" role="status">Đang đối soát phiên bản chờ bằng Upload ID; tự dừng sau tối đa 60 giây.</p>}
      {!busy && !error && items.length === 0 && <EmptyState title="Chưa có file ở trang này." description="Phiên bản tài liệu được hiển thị từ phản hồi của backend. Dùng phân trang hoặc tải lại để kiểm tra." />}
      <ul className="file-list version-list">{items.map(file => <li key={file.id} className="file-card" data-file-version-id={file.id}>
        <div className="file-card__heading"><span className="file-symbol" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3h8l4 4v14H6z M14 3v5h5 M9 12h6 M9 16h6" /></svg></span><h4>{file.filename}<span className="file-size"> · {file.size} byte</span></h4></div>
        <FileVersionStatus file={file} />
        {canOwn(project) && <label className="select-file"><input type="checkbox" aria-label={`Chọn bàn giao ${file.filename} · ${file.id}`} checked={Boolean(selected[file.id])} disabled={!isVerified(file)} onChange={event => setSelected(current => { const next = { ...current }; if (event.target.checked) next[file.id] = file; else delete next[file.id]; return next; })} />Chọn phiên bản bàn giao</label>}
        <div className="actions file-card__actions"><Button variant="secondary" disabled={actionBusy} onClick={() => check(file)}>Kiểm tra lại {file.filename}</Button>
          <Button disabled={actionBusy || !isVerified(file)} onClick={() => prepareDownload(file)}>Lấy link tải {file.filename}</Button>
          {canWrite(project) && <Button variant="secondary" disabled={actionBusy || uploadBusy} onClick={() => { setDownload(null); setTarget(file); }}>Thêm phiên bản {file.filename}</Button>}
        </div>
        {download?.id === file.id && <ExpiringDownloadLink key={`${download.id}:${download.expiresAt}`} download={download} />}
        <FileVersionDetails file={file} />
      </li>)}</ul>
      <Pager page={page} count={items.length} busy={busy || actionBusy} onPage={setPage} />
    </section>
    <CreateHandover project={project} members={members} files={Object.values(selected)} onCreated={onHandoverCreated} />
  </>;
}
