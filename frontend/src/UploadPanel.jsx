import { useEffect, useRef, useState } from 'react';
import { api } from './client.js';
import { canWrite } from './rules.js';
import { completeUpload, pollUpload, startUpload, validateFile } from './upload.js';
import { Button, EmptyState, ErrorNotice, TechnicalDetails } from './ui.jsx';
import { FileVersionStatus } from './FileVersionInfo.jsx';
import UploadProgress from './UploadProgress.jsx';
import { ApiError } from './api.js';
import { shouldPoll } from './upload.js';

export function VersionState({ file }) {
  return file && <div className="version-state"><FileVersionStatus file={file} />
    <TechnicalDetails title="Đối chiếu SHA-256"><dl className="technical-grid"><div><dt>SHA-256 dự kiến</dt><dd><code>{file.expectedSha256 || '—'}</code></dd></div><div><dt>SHA-256 thực tế</dt><dd><code>{file.actualSha256 || 'Chưa có kết quả'}</code></dd></div></dl></TechnicalDetails>
  </div>;
}
export default function UploadPanel({ project, targetFile = null, onChanged = () => {}, onUploaded = () => {}, onBusyChange = () => {} }) {
  const [file, setFile] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState(null);
  const [session, setSession] = useState(null), [state, setState] = useState(null), [progress, setProgress] = useState('');
  const active = useRef(null), form = useRef(null);
  useEffect(() => () => active.current?.abort(), []);
  async function track(sessionInfo, controller) {
    setProgress('Đang chờ kết quả đối soát…');
    const result = await pollUpload(api, project.id, sessionInfo.uploadId, { signal: controller.signal, onState: value => {
      setState(value); if (!shouldPoll(value.fileVersion) || value.fileVersion.integrityStatus === 'FAILED') onChanged();
    } });
    setProgress(result.stopped === 'limit' ? 'Đã dừng tự kiểm tra sau 15 lần. Bạn có thể kiểm tra lại.' : 'Đã nhận trạng thái từ backend.');
  }
  async function perform(action) {
    if (active.current) return;
    const controller = new AbortController(); active.current = controller; setBusy(true); onBusyChange(true); setError(null);
    try { await action(controller); }
    catch (e) { if (e.name !== 'AbortError') setError(e); else setProgress('Đã dừng chờ. Thao tác trên máy chủ có thể vẫn đã xảy ra; không tự gửi lại PUT.'); }
    finally { active.current = null; setBusy(false); onBusyChange(false); }
  }
  function submit(event) {
    event.preventDefault();
    perform(async controller => {
      setSession(null); setState(null);
      setProgress('Đang kiểm tra file…'); validateFile(file);
      if (targetFile && targetFile.filename !== file?.name) throw new ApiError(409, 'FILE_NAME_CONFLICT');
      const result = await startUpload(api, project.id, file, { fileId: targetFile?.fileId, signal: controller.signal,
        onSession: setSession, onProgress: setProgress });
      setState(result.state); onUploaded(); onChanged(); setFile(null); form.current?.reset();
      await track(result.session, controller);
    });
  }
  return <section className="card upload-panel"><h3>Upload file</h3>
    <p className="upload-intro">{targetFile ? 'Thêm phiên bản vào tài liệu đã chọn.' : 'Tải tài liệu mới lên dự án.'} Toàn vẹn nội dung được kiểm tra riêng sau khi upload.</p>
    {!canWrite(project) ? <EmptyState title="Quyền xem tài liệu" description="Viewer chỉ xem và tải file đã VERIFIED." /> : <>
      {targetFile && <p className="upload-target">Thêm phiên bản cho <strong>{targetFile.filename}</strong>. File ID: <code>{targetFile.fileId}</code>. Giữ nguyên tên file khi chọn.</p>}
      <form ref={form} onSubmit={submit} className="upload-form"><label htmlFor="upload-file">Chọn file</label><input id="upload-file" type="file" required disabled={busy} aria-describedby="upload-file-help" onChange={event => setFile(event.target.files?.[0] || null)} />
        {file && <div className="upload-selection" aria-label="File đã chọn"><span aria-hidden="true" className="upload-selection__symbol">↥</span><div><strong>{file.name}</strong><dl><div><dt>Kích thước</dt><dd>{file.size} byte</dd></div><div><dt>Loại nội dung</dt><dd>{file.type || 'application/octet-stream'}</dd></div></dl></div></div>}
        <p id="upload-file-help" className="field-help">Từ 1 byte đến 100 MiB (104857600 byte). Nội dung và tên file được giữ nguyên khi gửi.</p>
        <div className="actions"><Button type="submit" disabled={busy || !file}>Upload & kiểm tra SHA-256</Button></div>
      </form>
      <p className="upload-safety">PUT thành công chưa đồng nghĩa VERIFIED. Chỉ phiên bản được backend xác minh mới có thể tải và bàn giao.</p>
    </>}
    <ErrorNotice error={error} /><UploadProgress progress={progress} busy={busy} error={error} file={state?.fileVersion} />
    {session && <TechnicalDetails title="Thông tin kỹ thuật phiên upload"><dl className="technical-grid"><div><dt>Upload ID</dt><dd><code>{session.uploadId}</code></dd></div><div><dt>FileVersion ID</dt><dd><code>{session.fileVersionId}</code></dd></div><div><dt>S3 Version ID</dt><dd><code>{session.versionId || 'Chưa nhận được'}</code></dd></div></dl></TechnicalDetails>}
    <VersionState file={state?.fileVersion} />
    {busy && <button onClick={() => active.current?.abort()}>Dừng chờ</button>}
    {session?.versionId && canWrite(project) && state?.fileVersion?.uploadStatus !== 'AVAILABLE' && <button disabled={busy} onClick={() => perform(async controller => {
      const value = await completeUpload(api, session, controller.signal); setState(value); onChanged(); await track(session, controller);
    })}>Thử lại complete cùng Version ID</button>}
    {session && <button disabled={busy} onClick={() => perform(controller => track(session, controller))}>Kiểm tra lại upload</button>}
  </section>;
}
