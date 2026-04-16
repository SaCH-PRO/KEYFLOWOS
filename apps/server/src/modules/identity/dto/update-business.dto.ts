import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsNumber,
  IsObject,
  IsOptional,
  IsPhoneNumber,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum BusinessStage {
  IDEA = 'idea',
  STARTUP = 'startup',
  GROWTH = 'growth',
  SCALING = 'scaling',
  ESTABLISHED = 'established',
  MATURE = 'mature',
}

export enum TeamSize {
  SOLO = 'solo',
  SMALL = 'small',
  MEDIUM = 'medium',
  LARGE = 'large',
  ONE = '1',
  TWO_TO_FIVE = '2-5',
  SIX_TO_TEN = '6-10',
  ELEVEN_TO_FIFTY = '11-50',
  FIFTY_PLUS = '50+',
}

export class UpdateBusinessDto {
  @IsString()
  @IsOptional()
  @MaxLength(200)
  name?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  slug?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  timezone?: string;

  @IsString()
  @IsOptional()
  @MaxLength(10)
  currency?: string;

  @IsUrl({}, { message: 'logoUrl must be a valid URL' })
  @IsOptional()
  @MaxLength(2048)
  logoUrl?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  address?: string;

  @IsOptional()
  @IsPhoneNumber(undefined, { message: 'phone must be a valid phone number' })
  @MaxLength(30)
  phone?: string;

  @IsEmail({}, { message: 'email must be a valid email address' })
  @IsOptional()
  @MaxLength(255)
  email?: string;

  @IsUrl({}, { message: 'website must be a valid URL' })
  @IsOptional()
  @MaxLength(2048)
  website?: string;

  @IsUrl({}, { message: 'facebook must be a valid URL' })
  @IsOptional()
  @MaxLength(2048)
  facebook?: string;

  @IsUrl({}, { message: 'instagram must be a valid URL' })
  @IsOptional()
  @MaxLength(2048)
  instagram?: string;

  @IsUrl({}, { message: 'twitter must be a valid URL' })
  @IsOptional()
  @MaxLength(2048)
  twitter?: string;

  @IsUrl({}, { message: 'linkedin must be a valid URL' })
  @IsOptional()
  @MaxLength(2048)
  linkedin?: string;

  @IsUrl({}, { message: 'tiktok must be a valid URL' })
  @IsOptional()
  @MaxLength(2048)
  tiktok?: string;

  @IsUrl({}, { message: 'youtube must be a valid URL' })
  @IsOptional()
  @MaxLength(2048)
  youtube?: string;

  @IsString()
  @IsOptional()
  @MaxLength(30)
  whatsapp?: string;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  primaryColor?: string;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  secondaryColor?: string;

  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  @Type(() => Number)
  defaultTaxRate?: number;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  complianceStatus?: string;

  @IsObject()
  @IsOptional()
  complianceData?: Record<string, boolean>;

  @IsString()
  @IsOptional()
  lastHealthCheck?: string;

  @IsBoolean()
  @IsOptional()
  storeEnabled?: boolean;

  @IsObject()
  @IsOptional()
  businessHours?: Record<string, { open: string; close: string; closed: boolean }>;

  @IsBoolean()
  @IsOptional()
  onboardingComplete?: boolean;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  tagline?: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  description?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  city?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  country?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  industry?: string;

  @IsObject()
  @IsOptional()
  metaData?: Record<string, any>;

  @IsString()
  @IsOptional()
  @MaxLength(300)
  headline?: string;

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  bio?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  skills?: string[];

  @IsEnum(BusinessStage, { message: `businessStage must be one of: ${Object.values(BusinessStage).join(', ')}` })
  @IsOptional()
  businessStage?: BusinessStage;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  interests?: string[];

  @IsEnum(TeamSize, { message: `teamSize must be one of: ${Object.values(TeamSize).join(', ')}` })
  @IsOptional()
  teamSize?: TeamSize;

  @IsBoolean()
  @IsOptional()
  acceptingWork?: boolean;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  currentCapacity?: 'OPEN' | 'LIMITED' | 'FULL';

  @IsString()
  @IsOptional()
  @MaxLength(100)
  leadTime?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  preferredProjectTypes?: string[];

  @IsString()
  @IsOptional()
  @MaxLength(100)
  budgetFit?: string;

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  positioningStatement?: string;
}
