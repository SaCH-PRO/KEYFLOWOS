import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class DelegateApprovalStepDto {
  @IsString()
  @IsNotEmpty()
  delegatedTo!: string;

  @IsString()
  @IsOptional()
  comment?: string;
}
