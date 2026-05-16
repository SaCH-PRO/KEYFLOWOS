import { IsString, IsOptional, IsIn } from 'class-validator';

export class UpdateOrgUnitDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsIn(['BRANCH', 'DEPARTMENT', 'DIVISION', 'TEAM', 'WAREHOUSE'])
  type?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  managerId?: string;

  @IsOptional()
  @IsString()
  parentId?: string;
}
