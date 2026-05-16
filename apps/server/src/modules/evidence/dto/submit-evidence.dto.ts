import { IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, IsUrl, ValidateNested } from 'class-validator';

export const EVIDENCE_TYPES = ['photo', 'file', 'signature', 'checklist', 'message', 'note', 'document'] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

export class SubmitEvidenceDto {
  @IsIn(EVIDENCE_TYPES)
  evidenceType!: EvidenceType;

  @IsUrl()
  url!: string;

  @IsString()
  @IsNotEmpty()
  storageKey!: string;

  @IsString()
  @IsOptional()
  mimeType?: string;

  @IsNumber()
  @IsOptional()
  sizeBytes?: number;

  @IsString()
  @IsNotEmpty()
  linkedType!: string;

  @IsString()
  @IsNotEmpty()
  linkedId!: string;

  @IsOptional()
  metadata?: Record<string, unknown>;
}
