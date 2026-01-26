import { IsOptional, IsString } from 'class-validator';

export class CreateProjectTaskDto {
  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  dueDate?: string;
}
