import { Type, Transform } from 'class-transformer';
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

const stripHtml = ({ value }: { value: any }) =>
  typeof value === 'string' ? value.replace(/<[^>]*>/g, '').trim() : value;

export class PublicBookingLatLngDto {
  @IsNumber()
  lat!: number;

  @IsNumber()
  lng!: number;
}

export class PublicCreateBookingDto {
  @IsString()
  @IsNotEmpty()
  serviceId!: string;

  @IsString()
  @IsOptional()
  staffId?: string | null;

  @IsISO8601({ strict: true })
  startTime!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Transform(stripHtml)
  firstName!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Transform(stripHtml)
  lastName!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  @Transform(stripHtml)
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  @Transform(stripHtml)
  phone!: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  @Transform(stripHtml)
  company?: string | null;

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  @Transform(stripHtml)
  notes?: string | null;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  @Transform(stripHtml)
  location?: string | null;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  locationPlaceId?: string | null;

  @IsObject()
  @IsOptional()
  @ValidateNested()
  @Type(() => PublicBookingLatLngDto)
  locationLatLng?: PublicBookingLatLngDto | null;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  storefrontSlug?: string | null;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  visitorId?: string | null;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  referralCode?: string | null;

  @IsString()
  @IsOptional()
  orgUnitId?: string | null;

  /**
   * V1-64 (SWP-BOOKING-PAYMENT-GATE, BUG-037): the payment method the customer
   * chose, if any. Without this field the global ValidationPipe (whitelist)
   * dropped it and no gate could read it. Read trimmed and upper-cased and
   * checked against the storefront checkout-method rule before anything is
   * written (BookingsController.publicCreateBooking,
   * BookingsService.assertPublicPaymentMethodOffered).
   */
  @IsString()
  @IsOptional()
  @MaxLength(32)
  paymentMethod?: string | null;
}
