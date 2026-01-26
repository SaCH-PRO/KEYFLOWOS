import { IsEmail, IsIn, IsString } from 'class-validator';

export class InviteMemberDto {
  @IsEmail()
  email!: string;

  @IsString()
  @IsIn(['OWNER', 'ADMIN', 'STAFF'])
  role!: string;
}
