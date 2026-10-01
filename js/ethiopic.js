// ethiopic.js — Ethiopian (Ge'ez / Amete Mihret) calendar conversion.
// Ethiopian facilities document dates in the Ethiopian calendar; the app shows
// both EC and Gregorian. Conversion via Julian Day Number (Beyene–Kudlek method).

const JD_EPOCH_AMETE_MIHRET = 1723856; // Ethiopic epoch offset

export const EC_MONTHS = [
  'Meskerem', 'Tikimt', 'Hidar', 'Tahsas', 'Tir', 'Yekatit',
  'Megabit', 'Miazia', 'Ginbot', 'Sene', 'Hamle', 'Nehase', 'Pagume',
];
export const EC_MONTHS_AM = [
  'መስከረም', 'ጥቅምት', 'ኅዳር', 'ታኅሣሥ', 'ጥር', 'የካቲት',
  'መጋቢት', 'ሚያዝያ', 'ግንቦት', 'ሰኔ', 'ሐምሌ', 'ነሐሴ', 'ጳጉሜ',
];

function gregorianToJDN(year, month, day) {
  const a = Math.floor((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  return day + Math.floor((153 * m + 2) / 5) + 365 * y +
    Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) - 32045;
}

function ethiopicToJDN(year, month, day) {
  return (JD_EPOCH_AMETE_MIHRET + 365) + 365 * (year - 1) +
    Math.floor(year / 4) + 30 * month + day - 31;
}

function jdnToEthiopic(jdn) {
  const r = (jdn - JD_EPOCH_AMETE_MIHRET) % 1461;
  const n = (r % 365) + 365 * Math.floor(r / 1460);
  const year = 4 * Math.floor((jdn - JD_EPOCH_AMETE_MIHRET) / 1461) +
    Math.floor(r / 365) - Math.floor(r / 1460);
  const month = Math.floor(n / 30) + 1;
  const day = (n % 30) + 1;
  return { year, month, day };
}

/** The Ethiopian date {year, month, day} of a Gregorian calendar day (month 1-12). No Date object, so no timezone. */
export function gregorianToEthiopic(year, month, day) {
  return jdnToEthiopic(gregorianToJDN(year, month, day));
}

/** The Gregorian calendar day {year, month (1-12), day} of an Ethiopian date. No Date object, so no timezone. */
export function ethiopicToGregorian(year, month, day) {
  const jdn = ethiopicToJDN(year, month, day);
  // inverse of gregorianToJDN (Fliegel-Van Flandern)
  const a = jdn + 32044;
  const b = Math.floor((4 * a + 3) / 146097);
  const c = a - Math.floor(146097 * b / 4);
  const d = Math.floor((4 * c + 3) / 1461);
  const e = c - Math.floor(1461 * d / 4);
  const m = Math.floor((5 * e + 2) / 153);
  return {
    year: 100 * b + d - 4800 + Math.floor(m / 10),
    month: m + 3 - 12 * Math.floor(m / 10),
    day: e - Math.floor((153 * m + 2) / 5) + 1,
  };
}

/**
 * Days in an Ethiopian month: 30 in months 1-12; Pagume (13) has 5, or 6 in
 * the year before a Gregorian leap year (year % 4 === 3, e.g. 2015 and 2019
 * EC), when the next Meskerem 1 falls on 12 September instead of the 11th.
 */
export function ecMonthDays(year, month) {
  if (month !== 13) return 30;
  return year % 4 === 3 ? 6 : 5;
}

/** Convert a JS Date (local time) to Ethiopian calendar date {year, month, day}. */
export function toEthiopic(date) {
  return gregorianToEthiopic(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

/** Convert an Ethiopian calendar date to a JS Date (at local midnight). */
export function fromEthiopic(year, month, day) {
  const g = ethiopicToGregorian(year, month, day);
  return new Date(g.year, g.month - 1, g.day);
}

/** The era after an Ethiopian year: EC in English, Amete Mihret abbreviated in Amharic. */
export const EC_ERA = Object.freeze({ en: 'EC', am: 'ዓ.ም.' });
export const ecEra = lang => (lang === 'am' ? EC_ERA.am : EC_ERA.en);

/** Format like "Sene 5, 2018 EC"; in Amharic, Amharic month names and era. */
export function formatEthiopic(date, lang = 'en') {
  const e = toEthiopic(date);
  const months = lang === 'am' ? EC_MONTHS_AM : EC_MONTHS;
  return `${months[e.month - 1]} ${e.day}, ${e.year} ${ecEra(lang)}`;
}
