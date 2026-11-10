import { TechnicalDetails } from './ui.jsx';

export function FileVersionStatus({ file }) {
  let note = '';
  if (file.uploadStatus === 'PENDING') note = 'Upload đang chờ hoàn tất; phiên bản chưa đủ điều kiện tải hoặc bàn giao.';
  else if (file.uploadStatus === 'FAILED') note = 'Upload không hoàn tất. Kiểm tra lại trạng thái trước khi tiếp tục.';
  else if (file.uploadStatus === 'EXPIRED') note = 'Phiên upload đã hết hạn; phiên bản chưa đủ điều kiện tải hoặc bàn giao.';
  else if (file.integrityStatus === 'MISMATCH') note = 'Checksum không khớp. File không được tải hoặc đưa vào gói bàn giao.';
  else if (file.integrityStatus === 'FAILED') note = 'Đối soát chưa thành công. Có thể kiểm tra lại khi kết quả Lambda hợp lệ xuất hiện.';
  else if (file.uploadStatus === 'AVAILABLE' && file.integrityStatus === 'INTEGRITY_PENDING') note = 'Upload đã hoàn tất; đang chờ backend đối soát SHA-256.';
  else if (file.uploadStatus === 'AVAILABLE' && file.integrityStatus === 'VERIFIED') note = 'Phiên bản đã được backend xác minh toàn vẹn.';
  return <div className="file-version-state">
    <div className="version-badges"><span>Upload: <strong className="version-badge" data-stage="upload" data-state={file.uploadStatus}>{file.uploadStatus}</strong></span><span>Integrity: <strong className="version-badge" data-stage="integrity" data-state={file.integrityStatus}>{file.integrityStatus}</strong></span></div>
    {note && <p className="file-state-note" data-state={file.integrityStatus}>{note}</p>}
  </div>;
}
export function FileVersionDetails({ file }) {
  return <TechnicalDetails title="Thông tin kỹ thuật phiên bản" accessibleLabel={`Thông tin kỹ thuật phiên bản ${file.id}`}><dl className="technical-grid">
    <div><dt>File ID</dt><dd><code>{file.fileId}</code></dd></div>
    <div><dt>FileVersion ID</dt><dd><code>{file.id}</code></dd></div>
    <div><dt>Upload ID</dt><dd><code>{file.uploadId}</code></dd></div>
    <div><dt>S3 Version ID</dt><dd><code>{file.versionId || 'Chưa complete'}</code></dd></div>
    {file.contentType && <div><dt>Content-Type</dt><dd>{file.contentType}</dd></div>}
    <div><dt>SHA-256 dự kiến</dt><dd><code>{file.expectedSha256 || '—'}</code></dd></div>
    <div><dt>SHA-256 thực tế</dt><dd><code>{file.actualSha256 || 'Chưa có kết quả'}</code></dd></div>
  </dl></TechnicalDetails>;
}
