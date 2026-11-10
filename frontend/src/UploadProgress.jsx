const phases = {
  'Đang kiểm tra file…': ['validate', 0, 'Kiểm tra file đã chọn'],
  'Đang tính SHA-256…': ['hash', 0, 'Tính SHA-256 từ nội dung file'],
  'Đang tạo phiên upload…': ['init', 1, 'Khởi tạo phiên upload'],
  'Đang gửi file lên S3…': ['put', 1, 'Gửi file tới S3'],
  'Đang complete đúng phiên bản S3…': ['complete', 1, 'Xác nhận đúng phiên bản S3'],
  'Đang chờ kết quả đối soát…': ['integrity', 2, 'Chờ kết quả kiểm tra toàn vẹn'],
};

export default function UploadProgress({ progress, busy, error, file }) {
  if (!progress) return null;
  let [phase, step, title] = phases[progress] || ['stopped', null, 'Trạng thái kiểm tra'];
  if (error) { title = 'Thao tác chưa hoàn tất'; }
  else if (!busy && file?.uploadStatus === 'AVAILABLE' && file.integrityStatus === 'VERIFIED') { phase = 'verified'; step = 2; title = 'Đã xác minh SHA-256'; }
  else if (!busy && file?.integrityStatus === 'MISMATCH') { phase = 'mismatch'; step = 2; title = 'Checksum không khớp'; }
  else if (!busy && (file?.uploadStatus === 'FAILED' || file?.integrityStatus === 'FAILED')) { phase = 'failed'; title = 'Cần kiểm tra lại kết quả'; }
  return <div className="upload-progress" data-phase={phase} data-failed={Boolean(error)}>
    <ol className="upload-steps" aria-label="Các bước upload">{['Chuẩn bị file', 'Gửi và complete', 'Đối soát SHA-256'].map((label, index) => <li key={label} aria-current={step === index ? 'step' : undefined}><span aria-hidden="true">{index + 1}</span>{label}</li>)}</ol>
    <div role="status" aria-live="polite" aria-atomic="true"><h4>{title}</h4><p>{error ? 'Dừng ở bước đã quan sát. Xem lỗi bên trên trước khi chọn thao tác tiếp theo.' : progress}</p></div>
  </div>;
}
