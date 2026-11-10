import { useEffect, useState } from 'react';
import { downloadUrl } from './files.js';

export default function ExpiringDownloadLink({ download, label = 'Tải phiên bản đã chọn', validUntil }) {
  const [expired, setExpired] = useState(false);
  const deadline = Math.min(Date.parse(download.expiresAt), Date.parse(validUntil || download.expiresAt));
  useEffect(() => {
    let timer;
    function schedule() {
      const remaining = deadline - Date.now();
      if (!(remaining > 0)) { setExpired(true); return; }
      timer = setTimeout(schedule, Math.min(remaining, 2147483647));
    }
    schedule();
    return () => clearTimeout(timer);
  }, [deadline]);
  let href;
  try { href = downloadUrl(download); } catch { href = null; }
  if (expired || !href || !(deadline > Date.now())) return <p role="status">Liên kết đã hết hạn hoặc không còn hợp lệ. Lấy link tải mới để tiếp tục.</p>;
  return <p className="file-download"><a href={href} target="_blank" rel="noopener noreferrer" onClick={event => {
    // Recheck at activation as background tabs may delay the expiry timer.
    try { downloadUrl(download); if (!(deadline > Date.now())) throw new Error('Expired access'); } catch { event.preventDefault(); setExpired(true); }
  }}>{label}</a><span>Hết hạn URL {new Date(download.expiresAt).toLocaleString('vi-VN')}</span></p>;
}
