'use strict';

function parseLocalDateTime(value) {
  if (typeof value !== 'string') return { ok: false };

  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(value);
  if (!match) return { ok: false };

  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const isDateTime = hourText !== undefined;
  const hour = isDateTime ? Number(hourText) : 0;
  const minute = isDateTime ? Number(minuteText) : 0;
  const second = isDateTime && secondText !== undefined ? Number(secondText) : 0;
  const date = new Date(year, month - 1, day, hour, minute, second, 0);

  if (
    date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day ||
    date.getHours() !== hour || date.getMinutes() !== minute || date.getSeconds() !== second
  ) {
    return { ok: false };
  }

  return { ok: true, kind: isDateTime ? 'datetime' : 'date', date };
}

function isNonNegativeInteger(value) {
  return typeof value === 'string' && /^\d+$/.test(value);
}

function parseEventLimit(value) {
  if (!isNonNegativeInteger(value)) return null;
  const parsed = Number(value);
  return parsed <= 10000 ? parsed : null;
}

function validateOrderedRange(from, to) {
  const fromDate = from && from.date ? from.date : from;
  const toDate = to && to.date ? to.date : to;
  return !fromDate || !toDate || fromDate < toDate;
}

// Without an explicit mode, a date-only update can target an existing all-day
// event, whose end date is inclusive at the CLI boundary. Timed boundaries
// always remain strictly ordered.
function validateUpdateRange(start, end) {
  if (!start || !end) return true;
  if (start.kind === 'date' && end.kind === 'date') {
    return start.date <= end.date;
  }
  return start.date < end.date;
}

module.exports = {
  parseLocalDateTime,
  isNonNegativeInteger,
  parseEventLimit,
  validateOrderedRange,
  validateUpdateRange,
};
