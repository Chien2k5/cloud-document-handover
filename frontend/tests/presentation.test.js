import test from 'node:test';
import assert from 'node:assert/strict';
import { storageQuota, formatBytes } from '../src/presentation.js';

test('C09.04: valid quota keeps used and reserved separate, including zero/full/near limit', () => {
  for (const [used, reserved, quota] of [[0, 0, 1], [100, 20, 1000], [900, 99, 1000], [900, 100, 1000], [0, 1000, 1000], [Number.MAX_SAFE_INTEGER, 0, Number.MAX_SAFE_INTEGER]]) {
    const result = storageQuota({ usedBytes: used, reservedBytes: reserved, quotaBytes: quota });
    assert.equal(result.used, used); assert.equal(result.reserved, reserved); assert.equal(result.quota, quota);
    assert.ok(Number.isFinite(result.usedPercent) && Number.isFinite(result.reservedPercent));
    assert.ok(result.usedPercent + result.reservedPercent <= 100);
  }
});
test('C09.04: zero quota violates contract min 1; missing, negative, unsafe or non-numeric data has no bar', () => {
  for (const value of [undefined, null, '1000', NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    for (const key of ['quotaBytes', 'usedBytes', 'reservedBytes']) assert.equal(storageQuota({ quotaBytes: 1000, usedBytes: 0, reservedBytes: 0, [key]: value }), null);
  }
  for (const project of [{ quotaBytes: 0, usedBytes: 0, reservedBytes: 0 }, { quotaBytes: 100, usedBytes: 90, reservedBytes: 11 }, { quotaBytes: Number.MAX_SAFE_INTEGER, usedBytes: Number.MAX_SAFE_INTEGER, reservedBytes: 1 }]) assert.equal(storageQuota(project), null);
});
test('C09.04: display units use binary divisors, round down and leave exact bytes to UI', () => {
  for (const [value, expected] of [[0, '0 byte'], [1, '1 byte'], [1023, '1023 byte'], [1024, '1 KiB'], [1536, '1.5 KiB'], [1048575, '1023.99 KiB'], [1048576, '1 MiB'], [1073741824, '1 GiB'], [1099511627776, '1 TiB'], [1125899906842624, '1 PiB'], [Number.MAX_SAFE_INTEGER, '7.99 PiB']]) assert.equal(formatBytes(value), expected);
  for (const invalid of [NaN, Infinity, undefined, null, '1024', -1, 0.1, Number.MAX_SAFE_INTEGER + 1]) assert.equal(formatBytes(invalid), '—');
});
