import { IsOptional, IsString, IsArray, IsNumber, IsInt, Min } from 'class-validator';

export class GoalsDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  shortTermGoals?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  longTermGoals?: string[];

  @IsOptional()
  @IsNumber()
  @Min(0)
  revenueTarget12m?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  customerTarget12m?: number;

  @IsOptional()
  @IsString()
  hiringPlans?: string;

  @IsOptional()
  @IsString()
  expansionPlans?: string;

  @IsOptional()
  @IsString()
  exitStrategy?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  biggestChallenges?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  helpNeeded?: string[];

  @IsOptional()
  @IsString()
  timelineUrgency?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
