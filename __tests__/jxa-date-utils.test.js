'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadDateUtils() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'lib', 'date-utils.jxa'), 'utf8');
  const context = {};
  vm.runInNewContext(source, context);
  return context.AccliDateUtils;
}

function readCommand(name) {
  return fs.readFileSync(path.join(__dirname, '..', 'scripts', `${name}.jxa`), 'utf8');
}

describe('scripts/lib/date-utils.jxa characterization', () => {
  let dateUtils;

  beforeEach(() => {
    dateUtils = loadDateUtils();
  });

  test('parses seconds-present and minutes-only local datetimes', () => {
    for (const [value, expectedSeconds] of [
      ['2025-01-15T14:30', 0],
      ['2025-01-15T14:30:45', 45],
    ]) {
      const date = dateUtils.parseDateTime(value);
      expect(date.getFullYear()).toBe(2025);
      expect(date.getMonth()).toBe(0);
      expect(date.getDate()).toBe(15);
      expect(date.getHours()).toBe(14);
      expect(date.getMinutes()).toBe(30);
      expect(date.getSeconds()).toBe(expectedSeconds);
    }
  });

  test('parses date-only values at local midnight', () => {
    const date = dateUtils.parseDateTime('2025-01-15');
    expect(date.getHours()).toBe(0);
    expect(date.getMinutes()).toBe(0);
    expect(date.getSeconds()).toBe(0);
  });

  test('adds one local calendar day to an all-day exclusive end across DST', () => {
    const date = dateUtils.parseAllDayDate('2025-03-09', true);
    expect(date.getFullYear()).toBe(2025);
    expect(date.getMonth()).toBe(2);
    expect(date.getDate()).toBe(10);
    expect(date.getHours()).toBe(0);
  });

  test('returns null instead of throwing for malformed all-day values', () => {
    for (const value of [null, undefined, '', '2025-02-30', 'not-a-date']) {
      expect(() => dateUtils.parseAllDayDate(value, true)).not.toThrow();
      expect(dateUtils.parseAllDayDate(value, true)).toBeNull();
    }
  });

  test('validates create dates and ranges without EventKit', () => {
    expect(dateUtils.validateCreateDates('2025-01-15', '2025-01-15', true).error).toBeUndefined();
    expect(dateUtils.validateCreateDates('2025-01-16', '2025-01-15', true).error).toMatchObject({ code: 'INVALID_RANGE' });
    expect(dateUtils.validateCreateDates('2025-01-15T10:00', '2025-01-15T10:00', false).error).toMatchObject({ code: 'INVALID_RANGE' });
    expect(dateUtils.validateCreateDates('2025-02-30', '2025-03-01', true).error).toMatchObject({ code: 'INVALID_DATETIME' });
  });

  test('validates update dates before EventKit while preserving unknown all-day same-day updates', () => {
    expect(dateUtils.validateUpdateDates('2025-01-15', '2025-01-15', false, false).error).toBeUndefined();
    expect(dateUtils.validateUpdateDates('2025-01-16', '2025-01-15', false, false).error).toMatchObject({ code: 'INVALID_RANGE' });
    expect(dateUtils.validateUpdateDates('2025-01-15T10:00', '2025-01-15T10:00', false, false).error).toMatchObject({ code: 'INVALID_RANGE' });
    expect(dateUtils.validateUpdateDates('', null, false, false).error).toMatchObject({ code: 'INVALID_DATETIME' });
    expect(dateUtils.validateUpdateDates('2025-01-15', '2025-01-15', true, false).error).toBeUndefined();
    expect(dateUtils.validateUpdateDates('2025-01-15', '2025-01-15', false, true).error).toMatchObject({ code: 'INVALID_DATETIME' });
  });

  test('enforces resolved target-mode ranges', () => {
    const allDayStart = dateUtils.parseAllDayDate('2025-01-15', false);
    const allDayEnd = dateUtils.parseAllDayDate('2025-01-15', true);
    const timed = dateUtils.parseDateTime('2025-01-15T10:00');
    expect(dateUtils.validateUpdateTargetRange(allDayStart, allDayEnd, true).error).toBeUndefined();
    expect(dateUtils.validateUpdateTargetRange(timed, timed, false).error).toMatchObject({ code: 'INVALID_RANGE' });
  });

  test('create and update invoke pure date validation before EventKit store access', () => {
    for (const [name, helper] of [['create', 'validateCreateDates'], ['update', 'validateUpdateDates']]) {
      const source = readCommand(name);
      expect(source.indexOf(`AccliDateUtils.${helper}`)).toBeGreaterThan(-1);
      expect(source.indexOf(`AccliDateUtils.${helper}`)).toBeLessThan(source.indexOf('var store = $.EKEventStore.alloc.init'));
    }
    expect(readCommand('update')).toContain('AccliDateUtils.validateUpdateTargetRange');
  });

  test('converts exclusive all-day ends to inclusive display dates and clamps invalid ends', () => {
    const start = dateUtils.parseDateTime('2025-01-15');
    const end = dateUtils.parseAllDayDate('2025-01-16', true);
    expect(dateUtils.formatDateOnly(dateUtils.displayEndDateForAllDay(start, end))).toBe('2025-01-16');

    const invalidEnd = dateUtils.parseDateTime('2025-01-14');
    expect(dateUtils.displayEndDateForAllDay(start, invalidEnd)).toBe(start);
  });

  test('accepts valid leap days and rejects normalized impossible values', () => {
    expect(dateUtils.formatDateOnly(dateUtils.parseDateTime('2024-02-29'))).toBe('2024-02-29');
    for (const value of ['2025-02-29', '2025-02-30', '2025-04-31', '2025-00-01', '2025-13-01', '2025-01-01T24:00', '2025-01-01T12:60', '2025-01-01T12:00:60']) {
      expect(dateUtils.parseDateTime(value)).toBeNull();
    }
  });

  test('validates complete non-negative integer strings', () => {
    for (const value of ['0', '01', '999']) expect(dateUtils.isNonNegativeInteger(value)).toBe(true);
    for (const value of ['-1', '1.5', '1x', ' 1', '1 ', '']) expect(dateUtils.isNonNegativeInteger(value)).toBe(false);
  });

  test('formats local timed and date-only values', () => {
    const date = dateUtils.parseDateTime('2025-07-04T09:05:07');
    expect(dateUtils.formatLocalDate(date)).toBe('2025-07-04T09:05:07');
    expect(dateUtils.formatDateOnly(date)).toBe('2025-07-04');
  });
});
