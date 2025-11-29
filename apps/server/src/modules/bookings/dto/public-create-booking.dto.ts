import { Type } from 'class-transformer';
import { IsISO8601, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class PublicCreateBookingDto {
  @IsString()
  @IsNotEmpty()
  serviceId!: string;

  @IsString()
  @IsNotEmpty()
  staffId!: string;

  @IsISO8601()
  @Type(() => Date)
  startTime!: Date;

  @IsString()
  @IsOptional()
  firstName?: string | null;

  @IsString()
  @IsOptional()
  lastName?: string | null;

  @IsString()
  @IsOptional()
  email?: string | null;

  @IsString()
  @IsOptional()
  phone?: string | null;
}
