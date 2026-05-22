import { IsNumber, IsOptional, IsArray, IsString } from 'class-validator';

export class UpdateWorkloadConfigDto {
  @IsNumber()
  @IsOptional()
  dailyCapacityHours?: number;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  skillIds?: string[];
}

export class UpdateStaffWorkloadConfigDto {
  @IsNumber()
  @IsOptional()
  maxHoursPerWeek?: number;

  @IsNumber()
  @IsOptional()
  hourlyRate?: number;
}
