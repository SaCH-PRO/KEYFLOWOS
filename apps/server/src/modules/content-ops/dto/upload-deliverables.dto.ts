import { IsArray, IsNotEmpty, IsString } from 'class-validator';

export class UploadDeliverablesDto {
  @IsArray()
  @IsString({ each: true })
  fileIds!: string[];

  @IsString()
  @IsNotEmpty()
  folderId!: string;
}
