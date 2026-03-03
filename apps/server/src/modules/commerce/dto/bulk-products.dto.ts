import { IsArray, IsIn, IsNotEmpty, IsString, ArrayMinSize } from 'class-validator';

export class BulkProductsDto {
  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1)
  ids!: string[];

  @IsString()
  @IsNotEmpty()
  @IsIn(['activate', 'deactivate', 'delete'])
  action!: 'activate' | 'deactivate' | 'delete';
}
