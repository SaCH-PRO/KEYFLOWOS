import { IsIn, IsNumberString, IsOptional, IsString } from 'class-validator';

export const APPROVAL_STATUSES = ['pending', 'approved', 'rejected', 'escalated', 'delegated', 'cancelled'] as const;

export class ListApprovalsQueryDto {
  @IsIn(APPROVAL_STATUSES)
  @IsOptional()
  status?: string;

  @IsString()
  @IsOptional()
  requestType?: string;

  @IsNumberString()
  @IsOptional()
  limit?: string;

  @IsNumberString()
  @IsOptional()
  offset?: string;
}
