import { IsString, IsNotEmpty } from 'class-validator';

export class TrackUsageDto {
  @IsString()
  @IsNotEmpty()
  usedInType!: string;

  @IsString()
  @IsNotEmpty()
  usedInId!: string;
}
