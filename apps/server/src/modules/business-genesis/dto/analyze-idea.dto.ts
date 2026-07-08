import { IsString, MinLength, MaxLength } from 'class-validator';

export class AnalyzeIdeaDto {
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  ideaText!: string;
}
