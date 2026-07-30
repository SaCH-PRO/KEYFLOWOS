import { IsString, IsOptional, IsArray, ValidateNested, MinLength, MaxLength, IsIn } from 'class-validator';
import { Type } from 'class-transformer';

export class ChatHistoryMessageDto {
  @IsIn(['user', 'assistant', 'system'])
  role!: 'user' | 'assistant' | 'system';

  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  content!: string;
}

export class ChatDto {
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  message!: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChatHistoryMessageDto)
  history?: ChatHistoryMessageDto[];
}
