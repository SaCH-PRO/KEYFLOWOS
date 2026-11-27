import { IsArray, IsBoolean, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, ValidateIf } from 'class-validator';

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
  sourceProductId?: string | null;

  @IsBoolean()
  @IsOptional()
  depositRequired?: boolean;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsIn(['PERCENT', 'FIXED'])
  depositType?: 'PERCENT' | 'FIXED' | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber()
  depositValue?: number | null;
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
  sourceProductId?: string | null;

  @IsBoolean()
  @IsOptional()
  depositRequired?: boolean;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsIn(['PERCENT', 'FIXED'])
  depositType?: 'PERCENT' | 'FIXED' | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber()
  depositValue?: number | null;
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
