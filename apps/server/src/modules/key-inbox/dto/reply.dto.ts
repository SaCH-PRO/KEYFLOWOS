import { IsIn, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class ReplyAttachmentDto {
  @IsString()
  type!: string;

  @IsString()
  url!: string;
}

export class ReplyDto {
  @IsString()
  @MaxLength(20000)
  contentText!: string;

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ReplyAttachmentDto)
  attachments?: ReplyAttachmentDto[];

  @IsOptional()
  @IsString()
  @IsIn(['draft', 'send'])
  mode?: 'draft' | 'send';
}
