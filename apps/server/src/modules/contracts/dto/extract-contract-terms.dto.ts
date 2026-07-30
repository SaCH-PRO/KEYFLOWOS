import { IsOptional, IsString, MinLength } from 'class-validator';

export class ExtractContractTermsDto {
  @IsOptional()
  @IsString()
  sourceAssetId?: string;

  @IsOptional()
  @IsString()
  sourceDocumentInstanceId?: string;

  @IsOptional()
  @IsString()
  sourceDriveFileId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  url?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  base64Content?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  filename?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  mimeType?: string;
}
