import { IsString, IsOptional, IsObject, IsInt, Min, Max } from 'class-validator';

export class CreateKeyCommandDto {
  @IsString()
  rawInput!: string;

  @IsOptional()
  @IsString()
  inputMode?: 'TEXT' | 'VOICE' = 'TEXT';

  @IsOptional()
  @IsObject()
  intent?: Record<string, unknown>;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(4)
  autonomyLevel?: number = 0;
}
