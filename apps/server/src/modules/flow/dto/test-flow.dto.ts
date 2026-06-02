import { IsString, IsOptional, IsObject } from 'class-validator';

export class TestFlowDto {
  @IsOptional()
  @IsString()
  contactId?: string;

  @IsOptional()
  @IsString()
  sourceEventId?: string;

  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;
}
