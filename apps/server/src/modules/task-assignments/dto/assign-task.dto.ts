import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { TASK_TYPES, ASSIGNABLE_TYPES } from '../task-assignment.service';

export class AssignTaskDto {
  @IsIn(TASK_TYPES)
  taskType!: string;

  @IsString()
  @IsNotEmpty()
  taskId!: string;

  @IsIn(ASSIGNABLE_TYPES)
  assignableType!: string;

  @IsString()
  @IsNotEmpty()
  assignableId!: string;

  @IsString()
  @IsOptional()
  reason?: string;
}
