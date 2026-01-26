import { IsIn, IsOptional, IsString } from 'class-validator';

export class UpdateProjectDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'COMPLETED', 'ARCHIVED'])
  status?: string;
}
