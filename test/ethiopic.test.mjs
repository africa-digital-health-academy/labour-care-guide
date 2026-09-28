import test from 'node:test';
import assert from 'node:assert/strict';
import { toEthiopic, fromEthiopic, formatEthiopic } from '../js/ethiopic.js';

test('12 Sep 2023 is Meskerem 1, 2016 EC', () => {
  const e = toEthiopic(new Date(2023, 8, 12));
  assert.deepEqual([e.year, e.month, e.day], [2016, 1, 1]);
});

test('11 Sep 2024 is Meskerem 1, 2017 EC', () => {
  const e = toEthiopic(new Date(2024, 8, 11));
  assert.deepEqual([e.year, e.month, e.day], [2017, 1, 1]);
});

test('round trip 2016-1-1 EC to 2023-09-12', () => {
  const g = fromEthiopic(2016, 1, 1);
  assert.deepEqual([g.getFullYear(), g.getMonth(), g.getDate()], [2023, 8, 12]);
});

test('today round-trips and formats', () => {
  const today = new Date();
  const rt = fromEthiopic(...Object.values(toEthiopic(today)));
  assert.equal(rt.toDateString(), today.toDateString());
  assert.ok(formatEthiopic(today).length > 5);
});
