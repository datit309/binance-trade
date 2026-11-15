import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtUsd, fmtSignedUsd, fmtPrice, fmtQty, fmtPct, fmtTime } from '../extension/format.js';

test('fmtUsd', () => {
  assert.equal(fmtUsd(12430.5), '12,430.50');
  assert.equal(fmtUsd(-820), '−820.00');
  assert.equal(fmtUsd(null), '—');
});
test('fmtSignedUsd', () => {
  assert.equal(fmtSignedUsd(1475), '+1,475.00');
  assert.equal(fmtSignedUsd(-820), '−820.00');
  assert.equal(fmtSignedUsd(0), '0.00');
  assert.equal(fmtSignedUsd(-0.001), '0.00');
  assert.equal(fmtSignedUsd(null), '—');
});
test('fmtPrice', () => {
  assert.equal(fmtPrice(67450), '67,450.00');
  assert.equal(fmtPrice(148.3), '148.30');
  assert.equal(fmtPrice(116.27619), '116.2762');
  assert.equal(fmtPrice(0.00001234), '0.00001234');
  assert.equal(fmtPrice(0.71), '0.71');
  assert.equal(fmtPrice(null), '—');
});
test('fmtQty', () => {
  assert.equal(fmtQty(0.152), '0.152');
  assert.equal(fmtQty(1200), '1,200');
  assert.equal(fmtQty(0.123456789), '0.12345679');
  assert.equal(fmtQty(null), '—');
});
test('fmtPct', () => {
  assert.equal(fmtPct(11.87), '+11.9%');
  assert.equal(fmtPct(-6.2), '−6.2%');
  assert.equal(fmtPct(0), '0.0%');
  assert.equal(fmtPct(null), '—');
});
test('fmtTime', () => {
  assert.equal(fmtTime(new Date(2026, 0, 5, 9, 7).getTime()), '05/01/2026 09:07');
});
