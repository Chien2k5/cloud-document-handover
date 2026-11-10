import { useEffect, useRef, useState } from 'react';
import { api } from './client.js';
import { canWrite } from './rules.js';
import { completeUpload, pollUpload, startUpload } from './upload.js';
import { ErrorNotice } from './ui.jsx';
import { ApiError } from './api.js';
import { shouldPoll } from './upload.js';

export function VersionState({ file }) {
  return file && <div className="version-state"><p>Upload: <strong>{file.uploadStatus}</strong> · Integrity: <strong>{file.integrityStatus}</strong></p>
    {file.integrityStatus === 'MISMATCH' && <p className="error">Checksum không khớp. File không được tải hoặc đưa vào gói bàn giao.</p>}
    {file.integrityStatus === 'FAILED' && <p>Đối soát chưa thành công. Có thể kiểm tra lại khi kết quả Lambda hợp lệ xuất hiện.</p>}
    <p>SHA-256 dự kiến: <code>{file.expectedSha256 || '—'}</code></p><p>SHA-256 thực tế: <code>{file.actualSha256 || 'Chưa có kết quả'}</code></p>
  </div>;
}
export default function UploadPanel({ project, targetFile = null, onChanged = () => {}, onUploaded = () => {} }) {
  const [file, setFile] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState(null);
  const [session, setSession] = useState(null), [state, setState] = useState(null), [progress, setProgress] = useState('');
  const active = useRef(null), form = useRef(null);
  useEffect(() => () => active.current?.abort(), []);
  async function track(sessionInfo, controller) {
    const result = await pollUpload(api, project.id, sessionInfo.uploadId, { signal: controller.signal, onState: value => {
      setState(value); if (!shouldPoll(value.fileVersion) || value.fileVersion.integrityStatus === 'FAILED') onChanged();
    } });
    setProgress(result.stopped === 'limit' ? 'Đã dừng tự kiểm tra sau 15 lần. Bạn có thể kiểm tra lại.' : 'Đã nhận trạng thái từ backend.');
  }
  async function perform(action) {
    if (active.current) return;
    const controller = new AbortController(); active.current = controller; setBusy(true); setError(null);
    try { await action(controller); }
    catch (e) { if (e.name !== 'AbortError') setError(e); else setProgress('Đã dừng chờ. Thao tác trên máy chủ có thể vẫn đã xảy ra; không tự gửi lại PUT.'); }
    finally { active.current = null; setBusy(false); }
  }
  function submit(event) {
    event.preventDefault();
    perform(async controller => {
      setSession(null); setState(null);
      if (targetFile && targetFile.filename !== file?.name) throw new ApiError(409, 'FILE_NAME_CONFLICT');
      const result = await startUpload(api, project.id, file, { fileId: targetFile?.fileId, signal: controller.signal,
        onSession: setSession, onProgress: setProgress });
      setState(result.state); onUploaded(); onChanged(); setFile(null); form.current?.reset();
      await track(result.session, controller);
    });
  }
  return <section className="card"><h3>Upload file</h3>
    {!canWrite(project) ? <p>Viewer chỉ xem và tải file đã VERIFIED.</p> : <>
      {targetFile && <p>Thêm phiên bản cho <strong>{targetFile.filename}</strong>. File ID: <code>{targetFile.fileId}</code>. Giữ nguyên tên file khi chọn.</p>}
      <form ref={form} onSubmit={submit}><label>Chọn file<input type="file" required disabled={busy} onChange={event => setFile(event.target.files?.[0] || null)} /></label><button disabled={busy || !file}>Upload & kiểm tra SHA-256</button></form>
      <p>Tối đa 100 MiB, file phải có ít nhất 1 byte. PUT thành công chưa đồng nghĩa VERIFIED.</p>
    </>}
    <ErrorNotice error={error} />{progress && <p role="status">{progress}</p>}
    {session && <><p>Upload ID: <code>{session.uploadId}</code></p><p>FileVersion ID: <code>{session.fileVersionId}</code></p><p>S3 Version ID: <code>{session.versionId || 'Chưa nhận được'}</code></p></>}
    <VersionState file={state?.fileVersion} />
    {busy && <button onClick={() => active.current?.abort()}>Dừng chờ</button>}
    {session?.versionId && canWrite(project) && state?.fileVersion?.uploadStatus !== 'AVAILABLE' && <button disabled={busy} onClick={() => perform(async controller => {
      const value = await completeUpload(api, session, controller.signal); setState(value); onChanged(); await track(session, controller);
    })}>Thử lại complete cùng Version ID</button>}
    {session && <button disabled={busy} onClick={() => perform(controller => track(session, controller))}>Kiểm tra lại upload</button>}
  </section>;
}
