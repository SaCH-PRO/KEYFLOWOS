import { IsString, IsOptional, IsNotEmpty } from 'class-validator';

export class CreateSkillDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsOptional()
  category?: string = 'general';

  @IsString()
  @IsOptional()
  description?: string;
}
