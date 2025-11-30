import { IsIn } from 'class-validator';

export class UpdateQuoteStatusDto {
  @IsIn(['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED'])
  status!: 'DRAFT' | 'SENT' | 'ACCEPTED' | 'REJECTED';
}
