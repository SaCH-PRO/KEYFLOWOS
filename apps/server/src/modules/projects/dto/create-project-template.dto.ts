import { IsArray, IsString } from 'class-validator';

export class CreateProjectTemplateDto {
  @IsString()
  name!: string;

  @IsArray()
  taskTitles!: string[];
}
