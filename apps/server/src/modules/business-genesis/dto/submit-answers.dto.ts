import { IsObject } from 'class-validator';

export class SubmitAnswersDto {
  @IsObject()
  answers!: Record<string, unknown>;
}
