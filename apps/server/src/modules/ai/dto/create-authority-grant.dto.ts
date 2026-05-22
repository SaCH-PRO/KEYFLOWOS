import { IsString, IsNotEmpty, IsOptional, IsNumber, IsIn } from 'class-validator';

export class CreateAuthorityGrantDto {
  @IsString()
  @IsNotEmpty()
  grantorId!: string;

  @IsString()
  @IsIn(['KEY', 'USER'])
  granteeType!: 'KEY' | 'USER';

  @IsString()
  @IsNotEmpty()
  granteeId!: string;

  @IsString()
  @IsIn(['tier4_financial', 'tier4_publishing', 'tier4_operations'])
  scope!: 'tier4_financial' | 'tier4_publishing' | 'tier4_operations';

  @IsNumber()
  @IsOptional()
  maxAmount?: number;

  @IsString()
  @IsOptional()
  validFrom?: string;

  @IsString()
  @IsOptional()
  validUntil?: string;
}
