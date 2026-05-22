import { IsArray, IsBoolean, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export const CONTENT_TYPES = [
  'blog_post', 'social_post', 'email', 'video_script', 'flyer', 'whitepaper',
  'landing_page', 'case_study', 'newsletter', 'ad_copy', 'press_release',
] as const;

export const CONTENT_REQUEST_SOURCES = [
  'user_request', 'key_recommendation', 'campaign_calendar',
  'sales_signal', 'inventory_signal', 'customer_signal',
] as const;

export class CreateContentRequestDto {
  @IsIn(CONTENT_REQUEST_SOURCES)
  source!: string;

  @IsArray()
  @IsString({ each: true })
  contentTypes!: string[];

  @IsString()
  @IsNotEmpty()
  businessGoal!: string;

  @IsString()
  @IsOptional()
  targetAudience?: string;

  @IsString()
  @IsOptional()
  offer?: string;

  @IsString()
  @IsOptional()
  productOrService?: string;

  @IsString()
  @IsOptional()
  branch?: string;

  @IsString()
  @IsOptional()
  tone?: string;

  @IsString()
  @IsOptional()
  dueDate?: string;

  @IsIn(['low', 'normal', 'high', 'urgent'])
  @IsOptional()
  priority?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  requiredInputs?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  attachedAssetIds?: string[];

  @IsBoolean()
  @IsOptional()
  approvalRequired?: boolean;

  @IsBoolean()
  @IsOptional()
  invoiceOnDelivery?: boolean;
}
