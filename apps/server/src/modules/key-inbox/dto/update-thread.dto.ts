import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateThreadDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  subject?: string;

  @IsOptional()
  @IsEnum(['OPEN', 'WAITING', 'DONE', 'ARCHIVED'])
  status?: 'OPEN' | 'WAITING' | 'DONE' | 'ARCHIVED';

  @IsOptional()
  @IsEnum(['LOW', 'NORMAL', 'HIGH', 'URGENT'])
  priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
}
