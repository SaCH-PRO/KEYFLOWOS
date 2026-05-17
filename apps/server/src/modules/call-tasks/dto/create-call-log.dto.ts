import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsISO8601,
  IsIn,
  IsArray,
  IsInt,
  Min,
} from 'class-validator';

export const CALL_OUTCOMES = [
  'reached',
  'no_answer',
  'voicemail',
  'wrong_number',
  'callback_requested',
  'not_interested',
] as const;

export class CreateCallLogDto {
  @IsString()
  @IsNotEmpty()
  businessId!: string;

  @IsString()
  @IsOptional()
  contactId?: string;

  @IsString()
  @IsOptional()
  taskId?: string;

  @IsString()
  @IsNotEmpty()
  callerId!: string;

  @IsISO8601()
  @IsOptional()
  scheduledAt?: string;

  @IsString()
  @IsOptional()
  script?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  evidenceIds?: string[];
}
