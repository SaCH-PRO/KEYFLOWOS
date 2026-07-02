import { ContractStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { CONTRACT_STATUSES, CONTRACT_TYPES, ContractPartyDto } from './create-contract.dto';

export class UpdateContractDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  title?: string;

  @IsOptional()
  @IsIn(CONTRACT_TYPES)
  contractType?: string;

  @IsOptional()
  @IsIn(CONTRACT_STATUSES)
  status?: ContractStatus;

  @IsOptional()
  @IsDateString()
  effectiveDate?: string;

  @IsOptional()
  @IsDateString()
  expiryDate?: string;

  @IsOptional()
  @IsDateString()
  renewalDate?: string;

  @IsOptional()
  @IsString()
  renewalType?: string;

  @IsOptional()
  @IsNumber()
  renewalNoticeDays?: number;

  @IsOptional()
  @IsNumber()
  contractValue?: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  jurisdiction?: string;

  @IsOptional()
  @IsString()
  retentionPolicy?: string;

  @IsOptional()
  @IsDateString()
  retentionUntil?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  sourceAssetId?: string;

  @IsOptional()
  @IsString()
  sourceBusinessAssetId?: string;

  @IsOptional()
  @IsString()
  sourceDocumentInstanceId?: string;

  @IsOptional()
  @IsString()
  sourceDriveFileId?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ContractPartyDto)
  parties?: ContractPartyDto[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tagIds?: string[];
}
