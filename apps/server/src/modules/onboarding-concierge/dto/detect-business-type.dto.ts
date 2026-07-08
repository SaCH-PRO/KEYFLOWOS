import { IsString, MinLength, MaxLength } from 'class-validator';

export class DetectBusinessTypeDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  description!: string;
}
