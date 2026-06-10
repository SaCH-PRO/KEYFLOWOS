import { IsArray, IsString, ArrayMinSize } from 'class-validator';

export class BulkCommandItemsDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  ids!: string[];
}
