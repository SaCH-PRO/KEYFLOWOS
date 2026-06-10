import { Transform } from 'class-transformer';
import { IsBoolean, IsDateString, IsEmail, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { sanitize } from '../../../core/utils/sanitize';
import {
  CONTACT_AGE_GROUPS,
  CONTACT_RELATIONSHIP_TYPES,
  CONTACT_RELATIONSHIP_HEALTH_VALUES,
  CONTACT_PRIORITIES,
  CONTACT_NEXT_ACTION_TYPES,
} from '../crm.constants';

export class UpdateContactDto {
  @IsString()
  @IsOptional()
  @MaxLength(100)
  @Transform(({ value }) => sanitize(value))
  firstName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  @Transform(({ value }) => sanitize(value))
  lastName?: string;

  @IsEmail()
  @IsOptional()
  @MaxLength(254)
  email?: string;

  @IsString()
  @IsOptional()
  @MaxLength(30)
  phone?: string;

  @IsString()
  @IsIn(['LEAD', 'PROSPECT', 'CLIENT', 'LOST'])
  @IsOptional()
  status?: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  source?: string;

  @IsOptional()
  tags?: string[];

  @IsOptional()
  custom?: Record<string, any>;

  @IsOptional()
  customFieldValues?: Record<string, unknown>;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  @Transform(({ value }) => sanitize(value))
  displayName?: string;

  @IsEmail()
  @IsOptional()
  @MaxLength(254)
  secondaryEmail?: string;

  @IsString()
  @IsOptional()
  @MaxLength(30)
  secondaryPhone?: string;

  @IsString()
  @IsOptional()
  @MaxLength(30)
  whatsappNumber?: string;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  preferredChannel?: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  @Transform(({ value }) => sanitize(value))
  addressLine1?: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  @Transform(({ value }) => sanitize(value))
  addressLine2?: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  @Transform(({ value }) => sanitize(value))
  city?: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  @Transform(({ value }) => sanitize(value))
  state?: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  postalCode?: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  @Transform(({ value }) => sanitize(value))
  country?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  timezone?: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  @Transform(({ value }) => sanitize(value))
  companyName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  @Transform(({ value }) => sanitize(value))
  jobTitle?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  @Transform(({ value }) => sanitize(value))
  department?: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  industry?: string;

  @IsString()
  @IsOptional()
  ownerId?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  lifecycleStage?: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  sourceDetail?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  segment?: string;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  language?: string;

  @IsBoolean()
  @IsOptional()
  marketingOptIn?: boolean;

  @IsBoolean()
  @IsOptional()
  doNotContact?: boolean;

  @IsString()
  @IsOptional()
  @MaxLength(10000)
  @Transform(({ value }) => sanitize(value))
  notesInternal?: string;

  @IsString()
  @IsOptional()
  @IsIn([...CONTACT_AGE_GROUPS])
  ageGroup?: string;

  @IsString()
  @IsOptional()
  @IsIn([...CONTACT_RELATIONSHIP_TYPES])
  relationshipType?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  pipelineStage?: string;

  @IsString()
  @IsOptional()
  @IsIn([...CONTACT_RELATIONSHIP_HEALTH_VALUES])
  relationshipHealth?: string;

  @IsDateString()
  @IsOptional()
  nextActionAt?: string;

  @IsString()
  @IsOptional()
  @IsIn([...CONTACT_NEXT_ACTION_TYPES])
  nextActionType?: string;

  @IsString()
  @IsOptional()
  @IsIn([...CONTACT_PRIORITIES])
  priority?: string;

  @IsBoolean()
  @IsOptional()
  favorite?: boolean;

  @IsDateString()
  @IsOptional()
  archivedAt?: string;
}
