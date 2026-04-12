import { Type, Transform } from 'class-transformer';
import { IsISO8601, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

const stripHtml = ({ value }: { value: any }) =>
  typeof value === 'string' ? value.replace(/<[^>]*>/g, '').trim() : value;

export class PublicCreateBookingDto {
  @IsString()
  @IsNotEmpty()
  serviceId!: string;

  @IsString()
  @IsOptional()
  staffId?: string | null;

  @IsISO8601()
  @Type(() => Date)
  startTime!: Date;

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
  @MaxLength(1000)
  @Transform(stripHtml)
  notes?: string | null;
}
