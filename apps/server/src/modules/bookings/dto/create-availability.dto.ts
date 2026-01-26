import { Type } from 'class-transformer';
import { IsNumber, IsString, Max, Min } from 'class-validator';

export class CreateAvailabilityDto {
  @IsNumber()
  @Min(0)
  @Max(6)
  @Type(() => Number)
  dayOfWeek!: number;

  @IsString()
  startTime!: string;

  @IsString()
  endTime!: string;
}
