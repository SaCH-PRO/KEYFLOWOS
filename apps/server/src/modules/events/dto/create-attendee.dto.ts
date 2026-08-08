import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { sanitize } from '../../../core/utils/sanitize';

export const ATTENDEE_STATUSES = ['REGISTERED', 'CANCELLED', 'CHECKED_IN', 'REFUNDED'] as const;

export class CreateAttendeeDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  ticketTypeId?: string;

  @IsString()
  @IsEmail()
  @MaxLength(255)
  @Transform(({ value }) => sanitize(value, 255)?.toLowerCase())
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Transform(({ value }) => sanitize(value, 255))
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }) => sanitize(value, 100))
  phone?: string;

  @IsOptional()
  @IsString()
  @IsIn(ATTENDEE_STATUSES)
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  paymentId?: string;

  @IsOptional()
  @IsISO8601()
  checkedInAt?: Date;
}
