import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateNoteDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(10000)
  body!: string;

  @IsString()
  @IsOptional()
  source?: string;
}
