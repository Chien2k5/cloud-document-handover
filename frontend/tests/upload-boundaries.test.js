import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_FILE_BYTES, validateFile } from '../src/upload.js';

test('upload validation accepts 1 byte and exactly 100 MiB; rejects missing, zero, oversize and non-integer sizes', () => {
  // Validation-only size fixtures: no 100 MiB transmission or AWS claim.
  for (const size of [1, MAX_FILE_BYTES]) assert.doesNotThrow(() => validateFile({ size }));
  for (const file of [null, { size: 0 }, { size: MAX_FILE_BYTES + 1 }, { size: -1 }, { size: 1.5 }, { size: NaN }, { size: '1' }]) assert.throws(() => validateFile(file), error => error.code === 'INVALID_FILE_SIZE');
});
