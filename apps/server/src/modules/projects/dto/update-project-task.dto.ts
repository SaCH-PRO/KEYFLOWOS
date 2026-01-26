import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class UpdateProjectTaskDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  dueDate?: string;

  @IsOptional()
  @IsBoolean()
  isCompleted?: boolean;
}
