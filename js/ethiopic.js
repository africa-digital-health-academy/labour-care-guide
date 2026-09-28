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

/** Convert a JS Date (local time) to Ethiopian calendar date {year, month, day}. */
export function toEthiopic(date) {
  const jdn = gregorianToJDN(date.getFullYear(), date.getMonth() + 1, date.getDate());
  return jdnToEthiopic(jdn);
}

/** Convert an Ethiopian calendar date to a JS Date (at local midnight). */
export function fromEthiopic(year, month, day) {
  const jdn = ethiopicToJDN(year, month, day);
  // inverse of gregorianToJDN (Fliegel–Van Flandern)
  const a = jdn + 32044;
  const b = Math.floor((4 * a + 3) / 146097);
  const c = a - Math.floor(146097 * b / 4);
  const d = Math.floor((4 * c + 3) / 1461);
  const e = c - Math.floor(1461 * d / 4);
  const m = Math.floor((5 * e + 2) / 153);
  const day_ = e - Math.floor((153 * m + 2) / 5) + 1;
  const month_ = m + 3 - 12 * Math.floor(m / 10);
  const year_ = 100 * b + d - 4800 + Math.floor(m / 10);
  return new Date(year_, month_ - 1, day_);
}

/** Format like "Sene 5, 2018 EC" (or Amharic month if lang === 'am'). */
export function formatEthiopic(date, lang = 'en') {
  const e = toEthiopic(date);
  const months = lang === 'am' ? EC_MONTHS_AM : EC_MONTHS;
  return `${months[e.month - 1]} ${e.day}, ${e.year} EC`;
}
