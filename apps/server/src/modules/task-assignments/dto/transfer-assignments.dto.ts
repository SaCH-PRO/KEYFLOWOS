import { IsIn, IsNotEmpty, IsString } from 'class-validator';
import { ASSIGNABLE_TYPES } from '../task-assignment.service';

export class TransferAssignmentsDto {
  @IsIn(ASSIGNABLE_TYPES)
  fromType!: string;

  @IsString()
  @IsNotEmpty()
  fromId!: string;

  @IsIn(ASSIGNABLE_TYPES)
  toType!: string;

  @IsString()
  @IsNotEmpty()
  toId!: string;
}
