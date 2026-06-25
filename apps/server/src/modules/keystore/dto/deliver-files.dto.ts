import { IsArray, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

class DeliveryFileDto {
  @IsString()
  @IsNotEmpty()
  fileName: string;

  @IsString()
  @IsNotEmpty()
  url: string;

  @IsString()
  @IsNotEmpty()
  mimeType: string;

  @IsOptional()
  @IsNumber()
  sizeBytes?: number;
}

export class DeliverFilesDto {
  @IsArray()
  files: DeliveryFileDto[];

  @IsOptional()
  @IsString()
  note?: string;
}
