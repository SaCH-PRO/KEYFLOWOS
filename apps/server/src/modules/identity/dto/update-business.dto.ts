import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  Validate,
  ValidateIf,
  ValidatorConstraint,
  type ValidationArguments,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  BUSINESS_SELLS,
  hubDepthProblems,
  type BusinessHub,
  type BusinessSells,
  type HubDepth,
} from '../../../core/prisma/business-meta';

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

/**
 * V1-63 BIZ-SETTINGS-SERVER: a depth write is a map whose every key is a hub
 * and every value a depth (hubDepthProblems, core/prisma/business-meta.ts,
 * the check the service applies again to the metaData bag and to in-process
 * callers). Its message is bounded whatever the value holds (review
 * SEC-V63-1): this pipe runs before the controller's D-11 check.
 */
@ValidatorConstraint({ name: 'hubDepthMap', async: false })
export class HubDepthMapConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return hubDepthProblems(value).length === 0;
  }

  defaultMessage(args: ValidationArguments): string {
    return hubDepthProblems(args.value, args.property).join('; ');
  }
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

  @IsString()
  @IsOptional()
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

  @ValidateIf((o: UpdateBusinessDto) => o.vatNumber !== undefined && o.vatNumber !== null)
  @IsString()
  @MaxLength(64)
  vatNumber?: string | null;

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

  // onboardingComplete is deliberately absent (R0-09-ID-HARDEN, CF-22): the
  // global ValidationPipe runs with whitelist: true, so a client that still
  // sends it has it stripped, and completion goes through the onboarding
  // concierge's gated path instead of this generic PATCH.

  @IsBoolean()
  @IsOptional()
  messageIntakeEnabled?: boolean;

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

  @IsString()
  @IsOptional()
  @MaxLength(500)
  businessIntent?: string;

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

  @IsString()
  @IsOptional()
  @MaxLength(50)
  invoiceTemplate?: string;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  quoteTemplate?: string;

  // V1-63 BIZ-SETTINGS-SERVER (owner ruling D-150 'hubs'): the per-business v1
  // settings, stored in Business.metaData (core/prisma/business-meta.ts) and
  // owner-only like every field here (D-11). A value that is not a setting is
  // refused 400, null included (ValidateIf, not IsOptional, which would let
  // null through): a setting is set, never cleared. An absent field changes
  // nothing.

  @ValidateIf((o: UpdateBusinessDto) => o.sells !== undefined)
  @IsIn(BUSINESS_SELLS, { message: `sells must be one of: ${BUSINESS_SELLS.join(', ')}` })
  sells?: BusinessSells;

  @ValidateIf((o: UpdateBusinessDto) => o.advancedCrm !== undefined)
  @IsBoolean({ message: 'advancedCrm must be true or false' })
  advancedCrm?: boolean;

  /** Per hub, 'standard' or 'advanced'; a hub not named keeps its depth. */
  @ValidateIf((o: UpdateBusinessDto) => o.depth !== undefined)
  @Validate(HubDepthMapConstraint)
  depth?: Partial<Record<BusinessHub, HubDepth>>;
}
