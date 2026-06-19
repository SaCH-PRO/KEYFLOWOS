import { IsOptional, IsString } from 'class-validator';

export class RejectKeyActionProposalDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
