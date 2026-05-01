import { Type } from 'class-transformer';
import { IsObject, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { BookingLatLngDto } from './create-booking.dto';

export class UpdateBookingDto {
  @IsString()
  @IsOptional()
  @MaxLength(500)
  location?: string | null;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  locationPlaceId?: string | null;

  @IsObject()
  @IsOptional()
  @ValidateNested()
  @Type(() => BookingLatLngDto)
  locationLatLng?: BookingLatLngDto | null;
}
