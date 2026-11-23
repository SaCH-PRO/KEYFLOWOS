import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsDate, isISO8601 } from 'class-validator';

/**
 * A date field sent as an ISO 8601 string and handed to the service as a Date.
 *
 * Replaces `@IsISO8601()` + `@Type(() => Date)`, which refused every valid
 * value: class-transformer runs before class-validator, so @Type made the
 * string a Date and isISO8601 accepts only strings (see event-dates.dto.spec.ts
 * and the same defect in create-booking.dto.ts). Here only a string that passes
 * isISO8601 becomes a Date; anything else is left as it came and IsDate refuses
 * it. The accepted set is a subset of what @IsISO8601() accepts: the ISO
 * strings `new Date()` can parse. ISO basic, week and ordinal forms
 * (20261201T100000Z, 2026-W49-2, 2026-335) pass isISO8601 but parse to an
 * Invalid Date, which IsDate refuses. As with @Type(() => Date) before, a
 * non-strict isISO8601 admits an out-of-range day (2026-02-30), which Date
 * rolls over to 2026-03-02.
 */
export function IsIsoDate(): PropertyDecorator {
  return applyDecorators(
    Transform(({ value }) => (typeof value === 'string' && isISO8601(value) ? new Date(value) : value)),
    IsDate({ message: ({ property }) => `${property} must be a valid ISO 8601 date string` }),
  );
}
