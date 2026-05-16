import { IsNotEmpty, IsString } from 'class-validator';

export class VerifyEvidenceDto {
  @IsString()
  @IsNotEmpty()
  evidenceId!: string;

  @IsString()
  @IsNotEmpty()
  verifierId!: string;
}
