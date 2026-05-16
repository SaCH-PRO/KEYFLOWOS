import { IsIn, IsNumberString, IsOptional, IsString } from 'class-validator';
import { EVIDENCE_TYPES } from './submit-evidence.dto';

export class ListEvidenceQueryDto {
  @IsIn(EVIDENCE_TYPES)
  @IsOptional()
  type?: string;

  @IsNumberString()
  @IsOptional()
  limit?: string;

  @IsNumberString()
  @IsOptional()
  offset?: string;
}
