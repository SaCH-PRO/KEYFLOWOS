import { IsNotEmpty, IsOptional, IsString, IsIn, IsISO8601, MaxLength } from 'class-validator';

export class CreateTaskDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
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
  @IsString()
  assigneeType?: string;

  @IsOptional()
  @IsISO8601()
  remindAt?: string;

  @IsOptional()
  @IsString()
  source?: string;
}
