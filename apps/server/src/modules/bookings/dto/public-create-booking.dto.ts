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

  @IsISO8601()
  startTime!: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  @Transform(stripHtml)
  firstName?: string | null;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  @Transform(stripHtml)
  lastName?: string | null;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  @Transform(stripHtml)
  email?: string | null;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  @Transform(stripHtml)
  phone?: string | null;

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
}
