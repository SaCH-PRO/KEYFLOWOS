import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';

export class NextQuestionsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}
