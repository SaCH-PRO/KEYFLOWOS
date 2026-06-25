import { IsOptional, IsString } from 'class-validator';

export class AcceptQuoteDto {
  @IsOptional()
  @IsString()
  notes?: string;
}
