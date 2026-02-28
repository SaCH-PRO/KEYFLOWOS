import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateNoteDto {
  @IsString()
  @IsNotEmpty()
  body!: string;

  @IsString()
  @IsOptional()
  source?: string;
}
