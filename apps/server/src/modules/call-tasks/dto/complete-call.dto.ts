import {
  IsString,
  IsOptional,
  IsIn,
  IsInt,
  Min,
  IsArray,
} from 'class-validator';

export const CALL_OUTCOMES = [
  'reached',
  'no_answer',
  'voicemail',
  'wrong_number',
  'callback_requested',
  'not_interested',
] as const;

export class CompleteCallDto {
  @IsIn(CALL_OUTCOMES)
  outcome!: string;

  @IsInt()
  @Min(0)
  @IsOptional()
  duration?: number;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsString()
  @IsOptional()
  recordingUrl?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  evidenceIds?: string[];
}
