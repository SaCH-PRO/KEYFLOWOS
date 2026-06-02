import { IsString, IsOptional, IsInt, IsObject, IsDecimal, IsIn } from 'class-validator';

const SEVERITIES = ['INFO', 'WARN', 'CRITICAL'] as const;
const STATUSES = ['ACTIVE', 'RESOLVED', 'IGNORED'] as const;

export class CreateBusinessSignalDto {
  @IsString() module!: string;
  @IsString() type!: string;
  @IsIn(SEVERITIES) severity!: string;
  @IsString() title!: string;
  @IsString() @IsOptional() description?: string;
  @IsString() @IsOptional() entityType?: string;
  @IsString() @IsOptional() entityId?: string;
  @IsString() @IsOptional() contactId?: string;
  @IsInt() @IsOptional() score?: number;
  @IsString() @IsOptional() currency?: string;
  @IsObject() @IsOptional() data?: Record<string, unknown>;
}

export class UpdateBusinessSignalDto {
  @IsIn(STATUSES) @IsOptional() status?: string;
  @IsString() @IsOptional() title?: string;
  @IsString() @IsOptional() description?: string;
}
