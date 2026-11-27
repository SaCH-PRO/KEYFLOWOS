import { describe, it, expect } from 'vitest';
import {
  DEFAULT_BUSINESS_CLOSE_MIN,
  DEFAULT_BUSINESS_OPEN_MIN,
  PUBLIC_SLOT_INTERVAL_MINS,
  STRICT_ISO_DATETIME_WITH_TZ_RE,
  isOnSlotGrid,
  isStrictIsoDateTimeWithTz,
  parseTimeToMinutes,
  readBusinessDateWindows,
  readBusinessDayHours,
} from './business-hours.util';

describe('parseTimeToMinutes', () => {
  it('parses strict HH:MM and HH:MM:SS values', () => {
    expect(parseTimeToMinutes('00:00')).toBe(0);
    expect(parseTimeToMinutes('9:05')).toBe(545);
    expect(parseTimeToMinutes('09:30')).toBe(570);
    expect(parseTimeToMinutes('23:59')).toBe(1439);
    expect(parseTimeToMinutes('10:15:30')).toBe(615);
    expect(parseTimeToMinutes('  14:00  ')).toBe(840);
  });

  it('allows 24:00 only when allowMidnightEnd is true', () => {
    expect(parseTimeToMinutes('24:00', false)).toBeNull();
    expect(parseTimeToMinutes('24:00', true)).toBe(1440);
    expect(parseTimeToMinutes('24:00:00', true)).toBe(1440);
    expect(parseTimeToMinutes('24:01', true)).toBeNull();
  });

  it('rejects malformed or non-string values without returning NaN', () => {
    for (const bad of [null, undefined, 900, '', '9am', '25:00', '10:60', 'NaN:00', '10:00am', '-01:00']) {
      expect(parseTimeToMinutes(bad, true), String(bad)).toBeNull();
    }
  });
});

describe('readBusinessDayHours', () => {
  it('exports the canonical 09:00-17:00 default window', () => {
    expect(DEFAULT_BUSINESS_OPEN_MIN).toBe(540);
    expect(DEFAULT_BUSINESS_CLOSE_MIN).toBe(1020);
  });

  it('reads short keys (sun..sat)', () => {
    const hours = {
      sun: { closed: true },
      mon: { open: '09:00', close: '17:00', closed: false },
      sat: { open: '10:00', close: '24:00', closed: false },
    };
    expect(readBusinessDayHours(hours, 0)).toEqual({ closed: true });
    expect(readBusinessDayHours(hours, 1)).toEqual({
      closed: false,
      openMin: 540,
      closeMin: 1020,
      open: '09:00',
      close: '17:00',
    });
    expect(readBusinessDayHours(hours, 6)).toEqual({
      closed: false,
      openMin: 600,
      closeMin: 1440,
      open: '10:00',
      close: '24:00',
    });
  });

  it('reads long keys (sunday..saturday)', () => {
    const hours = {
      monday: { open: '10:00', close: '14:00', closed: false },
      tuesday: { open: '09:00', close: '17:00', closed: true },
      friday: { open: '8:30:00', close: '16:45:00' },
    };
    expect(readBusinessDayHours(hours, 1)).toEqual({
      closed: false,
      openMin: 600,
      closeMin: 840,
      open: '10:00',
      close: '14:00',
    });
    expect(readBusinessDayHours(hours, 2)).toEqual({ closed: true });
    expect(readBusinessDayHours(hours, 5)).toEqual({
      closed: false,
      openMin: 510,
      closeMin: 1005,
      open: '08:30',
      close: '16:45',
    });
  });

  it('prefers short key over long key when both are present', () => {
    const hours = {
      mon: { open: '10:00', close: '12:00', closed: false },
      monday: { open: '14:00', close: '16:00', closed: false },
      tue: { closed: true },
      tuesday: { open: '09:00', close: '17:00', closed: false },
    };
    expect(readBusinessDayHours(hours, 1)).toEqual({
      closed: false,
      openMin: 600,
      closeMin: 720,
      open: '10:00',
      close: '12:00',
    });
    expect(readBusinessDayHours(hours, 2)).toEqual({ closed: true });
  });

  it('supports case-insensitive lookup with short-key precedence', () => {
    expect(readBusinessDayHours({ Monday: { open: '11:00', close: '15:00', closed: false } }, 1)).toEqual({
      closed: false,
      openMin: 660,
      closeMin: 900,
      open: '11:00',
      close: '15:00',
    });
    expect(
      readBusinessDayHours(
        {
          MON: { open: '08:00', close: '12:00', closed: false },
          MONDAY: { open: '13:00', close: '17:00', closed: false },
        },
        1,
      ),
    ).toEqual({
      closed: false,
      openMin: 480,
      closeMin: 720,
      open: '08:00',
      close: '12:00',
    });
  });

  it('returns null for null/undefined/malformed inputs, absent days, or zero-length ranges', () => {
    expect(readBusinessDayHours(null, 1)).toBeNull();
    expect(readBusinessDayHours(undefined, 1)).toBeNull();
    expect(readBusinessDayHours('invalid', 1)).toBeNull();
    expect(readBusinessDayHours([], 1)).toBeNull();
    expect(readBusinessDayHours({}, 1)).toBeNull();
    expect(readBusinessDayHours({ mon: { open: '09:00', close: '17:00' } }, 2)).toBeNull();
    expect(readBusinessDayHours({ mon: { closed: false } }, 1)).toBeNull();
    expect(readBusinessDayHours({ mon: { open: '10:00', close: '10:00', closed: false } }, 1)).toBeNull();
    expect(readBusinessDayHours({ mon: { open: '00:00', close: '00:00', closed: false } }, 1)).toBeNull();
    expect(readBusinessDayHours({ mon: { open: 'bad', close: '17:00', closed: false } }, 1)).toBeNull();
    expect(readBusinessDayHours({ mon: { open: '09:00', close: '17:00', closed: 'true' } }, 1)).toBeNull();
    expect(readBusinessDayHours({ mon: { open: '09:00', close: '17:00' } }, -1)).toBeNull();
    expect(readBusinessDayHours({ mon: { open: '09:00', close: '17:00' } }, 7)).toBeNull();
    expect(readBusinessDayHours({ mon: { open: '09:00', close: '17:00' } }, 1.5)).toBeNull();
  });

  it('parses overnight spans (open > close) with closeMin past midnight (D-311 / P229)', () => {
    expect(readBusinessDayHours({ fri: { open: '18:00', close: '02:00', closed: false } }, 5)).toEqual({
      closed: false,
      openMin: 18 * 60,
      closeMin: 26 * 60,
      open: '18:00',
      close: '02:00',
    });
    expect(readBusinessDayHours({ mon: { open: '17:00', close: '09:00', closed: false } }, 1)).toEqual({
      closed: false,
      openMin: 17 * 60,
      closeMin: 33 * 60,
      open: '17:00',
      close: '09:00',
    });
    expect(readBusinessDayHours({ fri: { open: '18:00', close: '00:00', closed: false } }, 5)).toEqual({
      closed: false,
      openMin: 18 * 60,
      closeMin: 24 * 60,
      open: '18:00',
      close: '00:00',
    });
  });

  it('ignores prototype properties safely on both outer map and inner day entries', () => {
    const proto = { mon: { open: '09:00', close: '17:00', closed: false } };
    const obj = Object.create(proto);
    expect(readBusinessDayHours(obj, 1)).toBeNull();

    const innerProto = { open: '09:00', close: '17:00', closed: false };
    const innerObj = Object.create(innerProto);
    expect(readBusinessDayHours({ mon: innerObj }, 1)).toBeNull();
  });

  it('falls through from an incomplete/malformed short key to a valid long key instead of failing open', () => {
    expect(
      readBusinessDayHours({ mon: { closed: false }, monday: { closed: true } }, 1),
    ).toEqual({ closed: true });
    expect(
      readBusinessDayHours({ mon: {}, monday: { closed: true } }, 1),
    ).toEqual({ closed: true });
    expect(
      readBusinessDayHours(
        { mon: { open: 'bad', close: 'bad' }, monday: { open: '10:00', close: '12:00', closed: false } },
        1,
      ),
    ).toEqual({
      closed: false,
      openMin: 600,
      closeMin: 720,
      open: '10:00',
      close: '12:00',
    });
    // Without a valid fallback long key, an incomplete short key still returns null.
    expect(readBusinessDayHours({ mon: { closed: false } }, 1)).toBeNull();
  });

  it('preserves short-key precedence even when short key is mixed-case and long key is lowercase', () => {
    expect(
      readBusinessDayHours(
        { MON: { closed: true }, monday: { open: '09:00', close: '17:00', closed: false } },
        1,
      ),
    ).toEqual({ closed: true });
    expect(
      readBusinessDayHours(
        { Mon: { open: '11:00', close: '13:00' }, monday: { open: '09:00', close: '17:00' } },
        1,
      ),
    ).toEqual({
      closed: false,
      openMin: 660,
      closeMin: 780,
      open: '11:00',
      close: '13:00',
    });
  });
});

describe('isOnSlotGrid', () => {
  it('exports the canonical 30-minute public slot interval', () => {
    expect(PUBLIC_SLOT_INTERVAL_MINS).toBe(30);
  });

  it('accepts exact open + k*30 instants with zero seconds and zero milliseconds', () => {
    // 09:00 open -> :00 and :30 accepted
    expect(isOnSlotGrid(new Date('2030-01-07T09:00:00.000Z'), 9 * 60, 9 * 60)).toBe(true);
    expect(isOnSlotGrid(new Date('2030-01-07T09:30:00.000Z'), 9 * 60 + 30, 9 * 60)).toBe(true);
    expect(isOnSlotGrid(new Date('2030-01-07T16:00:00.000Z'), 16 * 60, 9 * 60)).toBe(true);
    // 09:15 open -> :15 and :45 accepted
    expect(isOnSlotGrid(new Date('2030-01-07T09:15:00.000Z'), 9 * 60 + 15, 9 * 60 + 15)).toBe(true);
    expect(isOnSlotGrid(new Date('2030-01-07T09:45:00.000Z'), 9 * 60 + 45, 9 * 60 + 15)).toBe(true);
    // Negative delta wrapping (e.g. 00:00 on unconfigured 09:00 default anchor)
    expect(isOnSlotGrid(new Date('2030-01-07T00:00:00.000Z'), 0, DEFAULT_BUSINESS_OPEN_MIN)).toBe(true);
    expect(isOnSlotGrid(new Date('2030-01-07T00:30:00.000Z'), 30, DEFAULT_BUSINESS_OPEN_MIN)).toBe(true);
    // Negative gridAnchorMin for previous-day offset overnight spillover (18:15 -> anchor -345 -> :15/:45)
    expect(isOnSlotGrid(new Date('2030-01-07T00:15:00.000Z'), 15, 18 * 60 + 15 - 1440)).toBe(true);
    expect(isOnSlotGrid(new Date('2030-01-07T00:45:00.000Z'), 45, 18 * 60 + 15 - 1440)).toBe(true);
    expect(isOnSlotGrid(new Date('2030-01-07T00:00:00.000Z'), 0, 18 * 60 + 15 - 1440)).toBe(false);
    expect(isOnSlotGrid(new Date('2030-01-07T00:30:00.000Z'), 30, 18 * 60 + 15 - 1440)).toBe(false);
  });

  it('rejects off-grid minutes, non-zero seconds, non-zero milliseconds, and invalid dates', () => {
    expect(isOnSlotGrid(new Date('2030-01-07T09:07:00.000Z'), 9 * 60 + 7, 9 * 60)).toBe(false);
    expect(isOnSlotGrid(new Date('2030-01-07T09:15:00.000Z'), 9 * 60 + 15, 9 * 60)).toBe(false);
    expect(isOnSlotGrid(new Date('2030-01-07T09:30:00.000Z'), 9 * 60 + 30, 9 * 60 + 15)).toBe(false);
    expect(isOnSlotGrid(new Date('2030-01-07T09:00:30.000Z'), 9 * 60, 9 * 60)).toBe(false);
    expect(isOnSlotGrid(new Date('2030-01-07T09:00:00.500Z'), 9 * 60, 9 * 60)).toBe(false);
    expect(isOnSlotGrid(new Date('not-a-date'), 9 * 60, 9 * 60)).toBe(false);
    expect(isOnSlotGrid(new Date('2030-01-07T00:15:00.000Z'), 15, DEFAULT_BUSINESS_OPEN_MIN)).toBe(false);
  });
});

describe('readBusinessDateWindows (D-311 / P229)', () => {
  it('returns spillover window on a closed next day when previous day crosses midnight', () => {
    const hours = {
      fri: { open: '18:00', close: '02:00', closed: false },
      sat: { closed: true },
    };
    expect(readBusinessDateWindows(hours, 5)).toEqual({
      status: 'open',
      windows: [
        { openMin: 1080, closeMin: 1560, gridAnchorMin: 1080, open: '18:00', close: '02:00', spillover: false },
      ],
    });
    expect(readBusinessDateWindows(hours, 6)).toEqual({
      status: 'open',
      windows: [
        { openMin: 0, closeMin: 120, gridAnchorMin: -360, open: '18:00', close: '02:00', spillover: true },
      ],
    });
  });

  it('wraps Sunday (0) spillover from Saturday (6) overnight shift and does not spill 18:00-00:00', () => {
    expect(
      readBusinessDateWindows(
        { sat: { open: '20:15', close: '01:15', closed: false }, sun: { closed: true } },
        0,
      ),
    ).toEqual({
      status: 'open',
      windows: [
        { openMin: 0, closeMin: 75, gridAnchorMin: 20 * 60 + 15 - 1440, open: '20:15', close: '01:15', spillover: true },
      ],
    });
    expect(
      readBusinessDateWindows(
        { fri: { open: '18:00', close: '00:00', closed: false }, sat: { closed: true } },
        6,
      ),
    ).toEqual({ status: 'closed', windows: [] });
  });

  it('combines previous-day spillover and same-day shift when both are open, and preserves unconfigured status', () => {
    expect(
      readBusinessDateWindows(
        {
          fri: { open: '18:00', close: '02:00', closed: false },
          sat: { open: '18:00', close: '02:00', closed: false },
        },
        6,
      ),
    ).toEqual({
      status: 'open',
      windows: [
        { openMin: 0, closeMin: 120, gridAnchorMin: -360, open: '18:00', close: '02:00', spillover: true },
        { openMin: 1080, closeMin: 1560, gridAnchorMin: 1080, open: '18:00', close: '02:00', spillover: false },
      ],
    });
    expect(readBusinessDateWindows({ fri: { open: '18:00', close: '02:00', closed: false } }, 6)).toEqual({
      status: 'unconfigured',
      windows: [
        { openMin: 0, closeMin: 120, gridAnchorMin: -360, open: '18:00', close: '02:00', spillover: true },
      ],
    });
  });
});

describe('isStrictIsoDateTimeWithTz [R1-SEC-01]', () => {
  it('accepts strict RFC 3339 / ISO 8601 date-times with explicit timezone offsets', () => {
    for (const valid of [
      '2030-01-07T10:00:00Z',
      '2030-01-07T10:00:00.000Z',
      '2030-01-07T10:00:00-04:00',
      '2030-01-07T10:00+05:30',
      '2028-02-29T10:00:00Z',
    ]) {
      expect(STRICT_ISO_DATETIME_WITH_TZ_RE.test(valid), valid).toBe(true);
      expect(isStrictIsoDateTimeWithTz(valid), valid).toBe(true);
    }
  });

  it('rejects partial/date-only/ordinal, whitespace/space-separated, timezone-less, 24:00 rollover, and impossible calendar dates', () => {
    for (const invalid of [
      '2030',
      '2030-01',
      '2030-01-07',
      '2030-007',
      '2030-01-07 ',
      ' 2030-01-07T10:00:00Z',
      '2030-01-07 10:00:00Z',
      '2030-01-07 10:00:00',
      '2030-01-07T10:00:00',
      '2030-01-07T24:00Z',
      '2026-02-30T10:00:00Z',
      '2026-02-29T10:00:00Z',
      '',
      'not-a-date',
      null,
      undefined,
      12345,
    ]) {
      expect(isStrictIsoDateTimeWithTz(invalid), String(invalid)).toBe(false);
    }
  });
});


