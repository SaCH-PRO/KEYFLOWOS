import { IsBoolean, IsOptional } from 'class-validator';

export class ExecuteKeyActionProposalDto {
  @IsOptional()
  @IsBoolean()
  confirm?: boolean;
}
