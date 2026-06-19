import { IsBoolean, IsObject, IsOptional, IsString } from 'class-validator';

export class ExecuteActionDto {
  @IsOptional()
  @IsString()
  messageId?: string;

  @IsBoolean()
  confirmed!: boolean;

  @IsOptional()
  @IsObject()
  payloadOverride?: Record<string, unknown>;
}
