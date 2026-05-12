import { IsString, IsOptional, IsObject } from 'class-validator';

export class UpdateProcurementRequestDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  priority?: string;

  @IsOptional()
  @IsString()
  internalNotes?: string;

  @IsOptional()
  @IsObject()
  brief?: Record<string, unknown>;
}
