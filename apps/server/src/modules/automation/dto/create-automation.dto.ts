import { IsObject, IsOptional, IsString } from 'class-validator';

export class CreateAutomationDto {
  @IsString()
  name!: string;

  @IsString()
  trigger!: string;

  @IsOptional()
  @IsObject()
  actionData?: Record<string, unknown>;
}
