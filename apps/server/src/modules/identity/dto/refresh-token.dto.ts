import { IsString, MaxLength, MinLength } from 'class-validator';

export class RefreshTokenDto {
  /**
   * The refresh token issued at login or by a previous refresh.
   *
   * It is the only credential on this request — the access token that would
   * normally authenticate the caller has expired, which is why they are here.
   */
  @IsString()
  @MinLength(1, { message: 'refreshToken is required' })
  @MaxLength(4096)
  refreshToken!: string;
}
