import test from 'node:test';
import assert from 'node:assert/strict';
import { stepperNext } from '../js/ui.js';

test('minus on an empty field does nothing (no jump to max)', () => {
  assert.equal(stepperNext(null, -1, { min: 0, max: 8 }), null);
});

test('plus on an empty field starts at min', () => {
  assert.equal(stepperNext(null, +1, { min: 0, max: 8 }), 0);
});

test('first tap on an empty field with a hinted previous value commits that value', () => {
  assert.equal(stepperNext(null, +1, { min: 0, max: 10, start: 6 }), 6);
  assert.equal(stepperNext(null, -1, { min: 0, max: 10, start: 6 }), 6);
});

test('values are clamped to the range', () => {
  assert.equal(stepperNext(10, +1, { min: 0, max: 10 }), 10);
  assert.equal(stepperNext(0, -1, { min: 0, max: 10 }), 0);
  assert.equal(stepperNext(4, +1, { min: 0, max: 10 }), 5);
});
