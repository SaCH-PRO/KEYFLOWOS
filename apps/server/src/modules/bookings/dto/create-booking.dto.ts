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

  @IsISO8601()
  @Type(() => Date)
  startTime!: Date;

  @IsISO8601()
  @Type(() => Date)
  endTime!: Date;

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
