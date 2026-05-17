import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsISO8601,
  IsIn,
} from 'class-validator';

export class CreateFollowUpDto {
  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsISO8601()
  @IsOptional()
  dueDate?: string;

  @IsIn(['LOW', 'NORMAL', 'HIGH', 'URGENT'])
  @IsOptional()
  priority?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsString()
  @IsOptional()
  assigneeId?: string;
}
