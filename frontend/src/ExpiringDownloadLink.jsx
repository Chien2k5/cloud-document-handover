import { useEffect, useState } from 'react';
import { downloadUrl } from './files.js';

export default function ExpiringDownloadLink({ download }) {
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    let timer;
    function schedule() {
      const remaining = Date.parse(download.expiresAt) - Date.now();
      if (!(remaining > 0)) { setExpired(true); return; }
      timer = setTimeout(schedule, Math.min(remaining, 2147483647));
    }
    schedule();
    return () => clearTimeout(timer);
  }, [download.expiresAt]);
  let href;
  try { href = downloadUrl(download); } catch { href = null; }
  if (expired || !href) return <p role="status">Liên kết đã hết hạn hoặc không còn hợp lệ. Lấy link tải mới để tiếp tục.</p>;
  return <p className="file-download"><a href={href} target="_blank" rel="noopener noreferrer" onClick={event => {
    // Recheck at activation as background tabs may delay the expiry timer.
    try { downloadUrl(download); } catch { event.preventDefault(); setExpired(true); }
  }}>Tải phiên bản đã chọn</a><span>Hết hạn {new Date(download.expiresAt).toLocaleString('vi-VN')}</span></p>;
}
