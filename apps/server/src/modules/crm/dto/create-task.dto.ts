import { IsNotEmpty, IsOptional, IsString, IsIn, IsISO8601 } from 'class-validator';

export class CreateTaskDto {
  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsOptional()
  @IsISO8601()
  dueDate?: string;

  @IsOptional()
  @IsIn(['NORMAL', 'HIGH', 'LOW'])
  priority?: string;

  @IsOptional()
  @IsString()
  assigneeId?: string;

  @IsOptional()
  @IsISO8601()
  remindAt?: string;
}
