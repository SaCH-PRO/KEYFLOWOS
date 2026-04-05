import { IsOptional, IsString, IsArray, IsInt, Min } from 'class-validator';

export class OperationsDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  teamSize?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  fullTimeEmployees?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  partTimeEmployees?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  contractors?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  operatingHoursPerWeek?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  toolsUsed?: string[];

  @IsOptional()
  @IsString()
  automationLevel?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  bottlenecks?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  keyProcesses?: string[];

  @IsOptional()
  @IsString()
  supplyChainComplexity?: string;

  @IsOptional()
  @IsString()
  qualityControlProcess?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
