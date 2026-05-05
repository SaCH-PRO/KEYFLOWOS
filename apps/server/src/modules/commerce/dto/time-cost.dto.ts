import { IsIn, IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export const TIME_COST_REF_TYPES = ['INVOICE', 'QUOTE', 'BOOKING', 'PROJECT', 'ORDER'] as const;

export class CreateTimeCostDto {
  @IsString()
  @IsIn(TIME_COST_REF_TYPES as unknown as string[])
  refType!: 'INVOICE' | 'QUOTE' | 'BOOKING' | 'PROJECT' | 'ORDER';

  @IsString()
  refId!: string;

  @IsInt()
  @Min(1)
  minutes!: number;

  @IsOptional() @IsString() contactId?: string | null;
  @IsOptional() @IsString() staffId?: string | null;
  @IsOptional() @IsNumber() @Min(0) costRate?: number | null;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsString() notes?: string | null;
  @IsOptional() @IsString() occurredAt?: string;
}

export class UpdateTimeCostDto {
  @IsOptional() @IsInt() @Min(1) minutes?: number;
  @IsOptional() @IsString() contactId?: string | null;
  @IsOptional() @IsString() staffId?: string | null;
  @IsOptional() @IsNumber() @Min(0) costRate?: number | null;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsString() notes?: string | null;
  @IsOptional() @IsString() occurredAt?: string;
}
