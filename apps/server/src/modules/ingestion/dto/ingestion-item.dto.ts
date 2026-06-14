import { IsArray, IsNumber, IsObject, IsOptional, IsString, Max, Min } from 'class-validator';

export class ProposedActionDto {
  @IsString()
  id!: string;

  @IsString()
  type!: string;

  @IsString()
  title!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsObject()
  payload!: Record<string, unknown>;
}

export class CorrectItemDto {
  @IsArray()
  correctedActions!: ProposedActionDto[];

  @IsString()
  @IsOptional()
  note?: string;
}

export class RejectItemDto {
  @IsString()
  @IsOptional()
  reason?: string;
}

export class UpdateInboxConfigDto {
  @IsOptional()
  intakeEnabled?: boolean;

  @IsNumber()
  @Min(0)
  @Max(1)
  @IsOptional()
  autoApproveThreshold?: number | null;

  @IsOptional()
  createContactsAutomatically?: boolean;
}

export class ListIngestionItemsQuery {
  @IsString()
  @IsOptional()
  status?: string;

  @IsString()
  @IsOptional()
  sourceType?: string;

  @IsString()
  @IsOptional()
  search?: string;

  @IsString()
  @IsOptional()
  intentType?: string;

  @IsString()
  @IsOptional()
  sortBy?: 'createdAt' | 'updatedAt' | 'confidence' = 'createdAt';

  @IsString()
  @IsOptional()
  sortOrder?: 'asc' | 'desc' = 'desc';

  @IsString()
  @IsOptional()
  cursor?: string;

  @IsNumber()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number = 25;
}
