import { IsString } from 'class-validator';

export class DetectBusinessTypeDto {
  @IsString()
  description!: string;
}
