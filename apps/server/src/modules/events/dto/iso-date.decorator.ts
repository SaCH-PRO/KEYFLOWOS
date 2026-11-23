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
 * it, so what is accepted is exactly what @IsISO8601() accepted.
 */
export function IsIsoDate(): PropertyDecorator {
  return applyDecorators(
    Transform(({ value }) => (typeof value === 'string' && isISO8601(value) ? new Date(value) : value)),
    IsDate({ message: ({ property }) => `${property} must be a valid ISO 8601 date string` }),
  );
}
