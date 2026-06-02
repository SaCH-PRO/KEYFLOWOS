import { IsString, IsOptional, IsInt, IsArray, Min, Max, Length } from 'class-validator';

export class CreateFlowDto {
  @IsString()
  @Length(1, 200)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsString()
  @Length(1, 100)
  category!: string;

  @IsOptional()
  @IsString()
  goal?: string;

  @IsOptional()
  @IsString()
  triggerSummary?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4)
  riskTier?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  blueprintTags?: string[];

  @IsOptional()
  nodes?: unknown[];

  @IsOptional()
  edges?: unknown[];
}
