import { IsString } from 'class-validator';

export class CreateStaffDto {
  @IsString()
  name!: string;
}
