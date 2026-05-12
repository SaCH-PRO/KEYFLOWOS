import { IsString, IsOptional, IsObject } from 'class-validator';

export class CreateProcurementRequestDto {
  @IsString()
  userPrompt!: string;

  @IsOptional()
  @IsString()
  priority?: string;

  @IsOptional()
  @IsObject()
  estimatedBudget?: Record<string, unknown>;
}
