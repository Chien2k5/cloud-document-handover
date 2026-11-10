// Presentation only: the API and backend remain authoritative for quota and permissions.
const validByteCount = value => Number.isSafeInteger(value) && value >= 0;
export function storageQuota(project) {
  const { usedBytes: used, reservedBytes: reserved, quotaBytes: quota } = project;
  if (![used, reserved, quota].every(validByteCount) || quota < 1 || !Number.isSafeInteger(used + reserved) || used + reserved > quota) return null;
  return { used, reserved, quota, usedPercent: used / quota * 100, reservedPercent: reserved / quota * 100 };
}
export function formatBytes(bytes) {
  if (!validByteCount(bytes)) return '—';
  const units = ['byte', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
  let index = 0, divisor = 1;
  while (bytes >= divisor * 1024 && index < units.length - 1) { index++; divisor *= 1024; }
  if (!index) return `${bytes} byte`;
  // Round down only the optional human-readable value; the UI also shows exact bytes.
  const hundredths = BigInt(bytes) * 100n / BigInt(divisor);
  const fraction = String(hundredths % 100n).padStart(2, '0').replace(/0+$/, '');
  return `${hundredths / 100n}${fraction ? '.' + fraction : ''} ${units[index]}`;
}
