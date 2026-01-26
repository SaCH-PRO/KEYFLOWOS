import { IsIn, IsString } from 'class-validator';

export class UpdateBookingStatusDto {
  @IsString()
  @IsIn(['PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED'])
  status!: string;
}
