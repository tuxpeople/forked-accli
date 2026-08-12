'use strict';

const { parseLocalDateTime, isNonNegativeInteger, parseEventLimit, validateOrderedRange, validateUpdateRange } = require('../lib/validation');

describe('local calendar input validation', () => {
  test.each([
    ['2024-02-29', 'date'],
    ['2025-01-15T14:30', 'datetime'],
    ['2025-01-15T14:30:45', 'datetime'],
  ])('parses valid %s', (value, kind) => {
    const result = parseLocalDateTime(value);
    expect(result).toMatchObject({ ok: true, kind });
  });

  test.each([
    '2025-02-29', '2025-02-30', '2025-04-31', '2025-00-01', '2025-13-01',
    '2025-01-01T24:00', '2025-01-01T12:60', '2025-01-01T12:00:60', '2025-1-01',
  ])('rejects invalid local datetime %s', (value) => {
    expect(parseLocalDateTime(value)).toEqual({ ok: false });
  });

  test('requires complete non-negative integer strings', () => {
    for (const value of ['0', '01', '123']) expect(isNonNegativeInteger(value)).toBe(true);
    for (const value of ['-1', '1.0', '1x', ' 1', '1 ', '']) expect(isNonNegativeInteger(value)).toBe(false);
  });

  test('bounds event limits and preserves zero', () => {
    expect(parseEventLimit('0')).toBe(0);
    expect(parseEventLimit('1')).toBe(1);
    expect(parseEventLimit('10000')).toBe(10000);
    for (const value of ['-1', '1.5', '1x', '10001']) expect(parseEventLimit(value)).toBeNull();
  });

  test('requires ordered ranges', () => {
    const start = parseLocalDateTime('2025-01-15');
    const equal = parseLocalDateTime('2025-01-15');
    const end = parseLocalDateTime('2025-01-16');
    expect(validateOrderedRange(start, equal)).toBe(false);
    expect(validateOrderedRange(end, start)).toBe(false);
    expect(validateOrderedRange(start, end)).toBe(true);
  });

  test('allows only date-only same-day update ranges while target mode is unknown', () => {
    const date = parseLocalDateTime('2025-01-15');
    const nextDate = parseLocalDateTime('2025-01-16');
    const timed = parseLocalDateTime('2025-01-15T10:00');
    expect(validateUpdateRange(date, date)).toBe(true);
    expect(validateUpdateRange(nextDate, date)).toBe(false);
    expect(validateUpdateRange(timed, timed)).toBe(false);
  });
});
