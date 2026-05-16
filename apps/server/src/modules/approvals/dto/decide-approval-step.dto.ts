import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class DecideApprovalStepDto {
  @IsIn(['approve', 'reject'])
  @IsNotEmpty()
  decision!: string;

  @IsString()
  @IsOptional()
  comment?: string;
}
