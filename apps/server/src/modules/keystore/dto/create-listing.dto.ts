import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class PricingTierDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsNumber()
  price: number;

  @IsString()
  @IsNotEmpty()
  currency: string;

  @IsString()
  description: string;

  @IsArray()
  @IsString({ each: true })
  included: string[];
}

class DeliverableDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  description: string;

  @IsInt()
  estimatedDays: number;
}

class AddonDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsNumber()
  price: number;

  @IsString()
  description: string;
}

class FaqItemDto {
  @IsString()
  @IsNotEmpty()
  question: string;

  @IsString()
  @IsNotEmpty()
  answer: string;
}

class BriefQuestionDto {
  @IsString()
  @IsNotEmpty()
  id: string;

  @IsString()
  @IsNotEmpty()
  question: string;

  @IsString()
  type: 'text' | 'textarea' | 'select' | 'multiselect' | 'number' | 'file';

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  options?: string[];

  @IsBoolean()
  required: boolean;

  @IsOptional()
  @IsString()
  placeholder?: string;
}

export class CreateListingDto {
  @IsString()
  @IsNotEmpty()
  categoryId: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  slug: string;

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsOptional()
  @IsString()
  shortDescription?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  features?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DeliverableDto)
  deliverables?: DeliverableDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PricingTierDto)
  pricingTiers?: PricingTierDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AddonDto)
  addons?: AddonDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FaqItemDto)
  faq?: FaqItemDto[];

  @IsOptional()
  @IsInt()
  estimatedDays?: number;

  @IsOptional()
  @IsBoolean()
  requiresBrief?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BriefQuestionDto)
  briefQuestions?: BriefQuestionDto[];

  @IsOptional()
  metadata?: Record<string, unknown>;
}
