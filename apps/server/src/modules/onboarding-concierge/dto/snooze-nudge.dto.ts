import { IsOptional, IsInt, Min } from 'class-validator';

export class SnoozeNudgeDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  days?: number;
}
