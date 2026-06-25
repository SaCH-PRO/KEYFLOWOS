import { IsArray, IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class SendMessageDto {
  @IsString()
  @IsNotEmpty()
  message: string;

  @IsOptional()
  @IsArray()
  attachments?: Array<{
    fileName: string;
    url: string;
    mimeType: string;
  }>;

  @IsOptional()
  @IsBoolean()
  internal?: boolean;
}
