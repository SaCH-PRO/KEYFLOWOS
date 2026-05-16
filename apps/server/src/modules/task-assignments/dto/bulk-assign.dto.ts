import { IsArray, IsIn, IsNotEmpty, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { TASK_TYPES, ASSIGNABLE_TYPES } from '../task-assignment.service';

class TaskRefDto {
  @IsIn(TASK_TYPES)
  taskType!: string;

  @IsString()
  @IsNotEmpty()
  taskId!: string;
}

export class BulkAssignDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TaskRefDto)
  taskIds!: TaskRefDto[];

  @IsIn(ASSIGNABLE_TYPES)
  assignableType!: string;

  @IsString()
  @IsNotEmpty()
  assignableId!: string;
}
