import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ContentReviewDto {
  @IsString()
  @IsNotEmpty()
  action!: 'approve' | 'request_changes' | 'submit_to_user';

  @IsString()
  @IsOptional()
  comment?: string;
}
