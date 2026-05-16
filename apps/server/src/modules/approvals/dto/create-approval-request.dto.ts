import { IsArray, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export const APPROVAL_REQUEST_TYPES = [
  'quote_discount',
  'expense',
  'content_delivery',
  'refund',
  'po',
  'time_off',
  'task_completion',
  'evidence_verification',
  'general',
] as const;

export class ApprovalStepInput {
  @IsNumber()
  @Type(() => Number)
  stepOrder!: number;

  @IsString()
  @IsNotEmpty()
  approverId!: string;
}

export class CreateApprovalRequestDto {
  @IsIn(APPROVAL_REQUEST_TYPES)
  requestType!: string;

  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsOptional()
  payload?: Record<string, unknown>;

  @IsNumber()
  @IsOptional()
  @Type(() => Number)
  threshold?: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ApprovalStepInput)
  steps!: ApprovalStepInput[];
}
