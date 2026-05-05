import { IsArray, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateCatalogServiceDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsNumber()
  duration!: number;

  @IsNumber()
  price!: number;

  @IsString()
  @IsOptional()
  description?: string;

  @IsNumber()
  @IsOptional()
  bufferMins?: number;

  @IsNumber()
  @IsOptional()
  leadTimeMins?: number;

  @IsString()
  @IsOptional()
  sourceProductId?: string;
}

export class UpdateCatalogServiceDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsNumber()
  @IsOptional()
  duration?: number;

  @IsNumber()
  @IsOptional()
  price?: number;

  @IsString()
  @IsOptional()
  description?: string;

  @IsNumber()
  @IsOptional()
  bufferMins?: number;

  @IsNumber()
  @IsOptional()
  leadTimeMins?: number;

  @IsString()
  @IsOptional()
  sourceProductId?: string;
}

export class BatchCatalogServicesDto {
  @IsArray()
  @IsOptional()
  add?: CreateCatalogServiceDto[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  remove?: string[];
}
