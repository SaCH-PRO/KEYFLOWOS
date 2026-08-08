import { IsString, IsOptional, IsBoolean, IsIn, IsEmail } from 'class-validator';

export class CreateAssignmentDto {
  // Path A: fill the position with an existing, logged-in team member.
  @IsOptional()
  @IsString()
  membershipId?: string;

  @IsOptional()
  @IsString()
  userId?: string;

  // Path B: fill the position with a contact-only staff member who won't log
  // into the app (e.g. front-desk, floor staff) but still needs to receive
  // delegated work and approvals over WhatsApp/SMS/email. Requires at least
  // contactName + contactPhone; enforced in StructureService.
  @IsOptional()
  @IsBoolean()
  isContactOnly?: boolean;

  @IsOptional()
  @IsString()
  contactName?: string;

  @IsOptional()
  @IsEmail()
  contactEmail?: string;

  @IsOptional()
  @IsString()
  contactPhone?: string;

  @IsOptional()
  @IsIn(['whatsapp', 'sms', 'email', 'none'])
  preferredChannel?: string;

  // Business owner/admin opt-in only — lets a reply to a pending approval on
  // preferredChannel auto-approve/reject instead of just notifying. Off by default.
  @IsOptional()
  @IsBoolean()
  autoApprovalViaReply?: boolean;

  @IsString()
  orgUnitId!: string;

  @IsOptional()
  @IsString()
  jobRoleId?: string;

  @IsOptional()
  @IsString()
  reportsToId?: string;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}
