import { IsOptional, IsString } from 'class-validator';

export class ExecuteActionDto {
  @IsString()
  actionIndex!: string;

  @IsOptional()
  @IsString()
  messageId?: string;
}
