import { IsArray, IsString, IsOptional, ArrayMaxSize } from 'class-validator';

export class ProfileConfirmDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(100)
  confirmedKeys?: string[];
}
