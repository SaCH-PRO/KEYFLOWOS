import { IsString, IsOptional, IsIn, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { sanitize } from '../../../core/utils/sanitize';

const VALID_SEVERITY = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const VALID_STATUS = ['OPEN', 'MITIGATED', 'CLOSED', 'ACCEPTED'];

export class CreateRiskDto {
  @IsString()
  @MaxLength(200)
  @Transform(({ value }) => sanitize(value))
  title!: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => (value ? sanitize(value) : value))
  description?: string;

  @IsString()
  @MaxLength(100)
  category!: string;

  @IsString()
  @IsIn(VALID_SEVERITY)
  severity!: string;

  @IsOptional()
  @IsString()
  @IsIn(['RARE', 'UNLIKELY', 'POSSIBLE', 'LIKELY', 'ALMOST_CERTAIN'])
  likelihood?: string;

  @IsOptional()
  @IsString()
  @IsIn(VALID_STATUS)
  status?: string = 'OPEN';

  @IsOptional()
  @IsString()
  ownerId?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => (value ? sanitize(value) : value))
  mitigation?: string;

  @IsOptional()
  @IsString()
  sourceType?: string;

  @IsOptional()
  @IsString()
  sourceId?: string;
}
