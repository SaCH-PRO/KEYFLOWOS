import {
  IsString,
  IsOptional,
  IsISO8601,
  IsIn,
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

export class ListCallsQueryDto {
  @IsString()
  @IsOptional()
  callerId?: string;

  @IsString()
  @IsOptional()
  contactId?: string;

  @IsIn([...CALL_OUTCOMES, 'scheduled', 'completed'])
  @IsOptional()
  status?: string;

  @IsISO8601()
  @IsOptional()
  fromDate?: string;

  @IsISO8601()
  @IsOptional()
  toDate?: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  limit?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  offset?: number;
}
