import { IsString, MaxLength, MinLength } from 'class-validator';

export class ChangePasswordDto {
  /**
   * Re-authentication, not identification — AuthGuard already established who
   * this is. This proves the caller knows the password they are replacing, so
   * a leaked access token on its own cannot be used to take the account over.
   *
   * No MinLength beyond 1: this is checked against what is actually stored, and
   * asserting a length here would reject a legacy password that predates the
   * current policy, locking that user out of changing it — the exact thing they
   * are trying to do.
   */
  @IsString()
  @MinLength(1, { message: 'currentPassword is required' })
  @MaxLength(256)
  currentPassword!: string;

  /**
   * Only a floor here. The real rules — composition and the Pwned Passwords
   * lookup — live in PasswordPolicyService, so change, reset and signup cannot
   * drift apart. Restating them in a decorator is how they would.
   */
  @IsString()
  @MinLength(12, { message: 'password must be at least 12 characters' })
  @MaxLength(256)
  newPassword!: string;
}
