import { IsArray, IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';

export class UpdateContentRequestDto {
  @IsString()
  @IsOptional()
  status?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  contentTypes?: string[];

  @IsString()
  @IsOptional()
  businessGoal?: string;

  @IsString()
  @IsOptional()
  targetAudience?: string;

  @IsString()
  @IsOptional()
  offer?: string;

  @IsString()
  @IsOptional()
  productOrService?: string;

  @IsString()
  @IsOptional()
  branch?: string;

  @IsString()
  @IsOptional()
  tone?: string;

  @IsString()
  @IsOptional()
  dueDate?: string;

  @IsIn(['low', 'normal', 'high', 'urgent'])
  @IsOptional()
  priority?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  assignedTeamMemberIds?: string[];

  @IsString()
  @IsOptional()
  googleDriveFolderId?: string;

  @IsBoolean()
  @IsOptional()
  approvalRequired?: boolean;
}
