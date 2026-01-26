import { IsObject, IsOptional, IsString } from 'class-validator';

export class UpdateAutomationDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  trigger?: string;

  @IsOptional()
  @IsObject()
  actionData?: Record<string, unknown>;
}
