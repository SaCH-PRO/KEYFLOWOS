import { Type } from 'class-transformer';
import {
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class BookingLatLngDto {
  @IsNumber()
  lat!: number;

  @IsNumber()
  lng!: number;
}

export class CreateBookingDto {
  @IsString()
  @IsOptional()
  contactId?: string;

  @IsString()
  @IsNotEmpty()
  serviceId!: string;

  @IsString()
  @IsNotEmpty()
  staffId!: string;

  // NOT @Type(() => Date). class-transformer runs before class-validator, so
  // @Type would hand isISO8601 a Date object — and isISO8601 is
  // `typeof value === 'string' && ...`, so it rejected every payload. A valid
  // ISO string came back as "startTime must be a valid ISO 8601 date string",
  // meaning booking creation returned 400 unconditionally.
  //
  // The type stays `string` because that is what actually arrives and what the
  // controller expects: bookings.controller.ts does `new Date(body.startTime)`.
  @IsISO8601()
  startTime!: string;

  @IsISO8601()
  endTime!: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  location?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  locationPlaceId?: string;

  @IsObject()
  @IsOptional()
  @ValidateNested()
  @Type(() => BookingLatLngDto)
  locationLatLng?: BookingLatLngDto;

  @IsString()
  @IsOptional()
  orgUnitId?: string;
}
