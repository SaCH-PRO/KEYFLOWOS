import {
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class BriefAnswerDto {
  @IsString()
  questionId: string;

  @IsString()
  question: string;

  @IsNotEmpty()
  answer: string | string[];
}

class SelectedAddonDto {
  @IsString()
  addonName: string;

  @IsNumber()
  price: number;
}

export class CreateOrderDto {
  @IsString()
  @IsNotEmpty()
  listingId: string;

  @IsString()
  @IsNotEmpty()
  pricingTier: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BriefAnswerDto)
  briefAnswers?: BriefAnswerDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SelectedAddonDto)
  selectedAddons?: SelectedAddonDto[];

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  contactId?: string;
}
