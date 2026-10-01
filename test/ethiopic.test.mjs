import test from 'node:test';
import assert from 'node:assert/strict';
import {
  toEthiopic, fromEthiopic, formatEthiopic, gregorianToEthiopic, ethiopicToGregorian, ecMonthDays,
} from '../js/ethiopic.js';

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

// ------------------------------------------------- M6: months and Pagume ----

test('M6: Pagume has 6 days in the year before a Gregorian leap year, else 5; every other month has 30', () => {
  assert.deepEqual([2015, 2016, 2017, 2018, 2019].map(y => ecMonthDays(y, 13)), [6, 5, 5, 5, 6]);
  for (let m = 1; m <= 12; m++) assert.equal(ecMonthDays(2018, m), 30);
  // the sixth day exists only then, and the day after the last Pagume day is Meskerem 1
  assert.deepEqual(ethiopicToGregorian(2015, 13, 6), { year: 2023, month: 9, day: 11 });
  assert.deepEqual(gregorianToEthiopic(2023, 9, 12), { year: 2016, month: 1, day: 1 });
  assert.deepEqual(gregorianToEthiopic(2024, 9, 10), { year: 2016, month: 13, day: 5 });
  assert.deepEqual(gregorianToEthiopic(2024, 9, 11), { year: 2017, month: 1, day: 1 }, '2016 EC has no Pagume 6');
  assert.deepEqual(ethiopicToGregorian(2019, 1, 1), { year: 2026, month: 9, day: 11 });
  assert.deepEqual(ethiopicToGregorian(2019, 13, 6), { year: 2027, month: 9, day: 11 });
});

test('M6: the timezone-free conversions agree with the Date-based ones', () => {
  const e = toEthiopic(new Date(2026, 6, 8));
  assert.deepEqual(gregorianToEthiopic(2026, 7, 8), e);
  assert.deepEqual(e, { year: 2018, month: 11, day: 1 }, 'Hamle 1, 2018 = 8 July 2026');
  const g = fromEthiopic(2018, 11, 1);
  assert.deepEqual(ethiopicToGregorian(2018, 11, 1), { year: g.getFullYear(), month: g.getMonth() + 1, day: g.getDate() });
});

test('M6: day by day over four years, the conversion matches the ICU Ethiopic calendar and round-trips', t => {
  const fmt = new Intl.DateTimeFormat('en-u-ca-ethiopic', { timeZone: 'UTC', year: 'numeric', month: 'numeric', day: 'numeric' });
  if (fmt.resolvedOptions().calendar !== 'ethiopic') {
    t.skip('this Node build has no ICU Ethiopic calendar');
    return;
  }
  const part = (parts, type) => Number(parts.find(x => x.type === type).value);
  let checked = 0;
  for (let ms = Date.UTC(2023, 8, 1); ms < Date.UTC(2027, 9, 1); ms += 86400000) {
    const d = new Date(ms);
    const [y, m, day] = [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
    const ec = gregorianToEthiopic(y, m, day);
    const icu = fmt.formatToParts(d);
    assert.deepEqual([ec.year, ec.month, ec.day], [part(icu, 'year'), part(icu, 'month'), part(icu, 'day')], d.toISOString());
    assert.deepEqual(ethiopicToGregorian(ec.year, ec.month, ec.day), { year: y, month: m, day }, d.toISOString());
    checked++;
  }
  assert.ok(checked >= 1461, `${checked} days: four full years, with Pagume 6 of 2015 and of 2019 EC`);
});
