import assert from 'node:assert/strict';
import { test } from 'node:test';
import { capacitySegments } from '../src/capacity.ts';

test('normal forecast keeps existing bytes separate from future allocation', () => {
    assert.deepEqual(capacitySegments({ total: 100, used: 40, reserved: 0, pending: 25, available: 60 }), { occupied: 40, pending: 25, free: 35 });
});
test('filesystem reservations are not offered as writable capacity', () => {
    assert.deepEqual(capacitySegments({ total: 100, used: 40, reserved: 10, pending: 25, available: 50 }), { occupied: 50, pending: 25, free: 25 });
});
test('overcommit is clipped visually, leaving no imaginary free segment', () => {
    assert.deepEqual(capacitySegments({ total: 100, used: 40, reserved: 0, pending: 200, available: 60 }), { occupied: 40, pending: 60, free: 0 });
});
test('unknown and empty storage do not display a full free disk', () => {
    for (const total of [-1, 0]) assert.deepEqual(capacitySegments({ total, used: 0, reserved: 0, pending: 20, available: 0 }), { occupied: 0, pending: 0, free: 0 });
});
