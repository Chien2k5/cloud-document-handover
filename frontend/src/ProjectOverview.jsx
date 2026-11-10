import { StatusBadge, TechnicalDetails } from './ui.jsx';
import { formatBytes, storageQuota } from './presentation.js';
import { projectHash } from './navigation.js';

export default function ProjectOverview({ project }) {
  const quota = storageQuota(project);
  return <div className="project-summary">
    <div className="project-summary__heading"><div><p className="eyebrow">Dự án đang chọn</p><h3>{project.name}</h3></div><div className="project-role">Vai trò: <StatusBadge>{project.role}</StatusBadge></div></div>
    <p className="project-description">{project.description || 'Chưa có mô tả.'}</p>
    <nav className="project-shortcuts" aria-label="Truy cập nhanh dự án">
      <a href={projectHash(project.id, 'files')}>Mở tài liệu <span aria-hidden="true">→</span></a>
      <a href={projectHash(project.id, 'members')}>Xem thành viên <span aria-hidden="true">→</span></a>
      <a href="#/handovers">Mở gói bàn giao <span aria-hidden="true">→</span></a>
    </nav>
    <section className="quota-panel" aria-label="Dung lượng dự án"><h4>Dung lượng lưu trữ</h4>
      {quota ? <>
        <dl className="quota-metrics">{[['Đã dùng', quota.used, 'used'], ['Đang giữ chỗ', quota.reserved, 'reserved'], ['Giới hạn', quota.quota, 'limit']].map(([label, value, kind]) => <div key={kind} className={`quota-metric quota-metric--${kind}`}><dt>{label}</dt><dd><strong>{value} byte</strong><span>Khoảng {formatBytes(value)}</span></dd></div>)}</dl>
        <div className="quota-track" role="img" aria-label={`Phân bổ dung lượng: ${quota.used} byte đã dùng; ${quota.reserved} byte đang giữ chỗ; giới hạn ${quota.quota} byte.`}>
          <span className="quota-track__used" style={{ width: `${quota.usedPercent}%` }} /><span className="quota-track__reserved" style={{ width: `${quota.reservedPercent}%` }} />
        </div>
        <p className="quota-note"><span className="quota-key quota-key--used" /> Đã dùng <span className="quota-key quota-key--reserved" /> Đang giữ chỗ</p>
        <p className="field-help quota-explanation">Dung lượng giữ chỗ dành cho upload đang chờ, chưa phải upload hoàn tất. Trạng thái xác minh nằm trong mục tài liệu.</p>
      </> : <p className="quota-warning" role="status">Dữ liệu dung lượng thiếu hoặc không hợp lệ. Tải lại quyền dự án để kiểm tra thông tin từ máy chủ.</p>}
    </section>
    <TechnicalDetails title="Thông tin kỹ thuật dự án"><p>Project ID: <code>{project.id}</code></p></TechnicalDetails>
  </div>;
}
