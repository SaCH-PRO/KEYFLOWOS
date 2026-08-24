import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class ForgotPasswordDto {
  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(255)
  email!: string;

  /**
   * Where the recovery link should land. Optional — the server falls back to
   * its configured site URL. Whatever arrives is checked against the allowed
   * origins before use: the link carries a session in its fragment, so an open
   * redirect here would hand the account to whoever chose the target.
   */
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  redirectTo?: string;
}

export class ResetPasswordDto {
  /**
   * The session Supabase places in the recovery link. Possession of it is what
   * proves the caller received the email, so it is the authentication for this
   * request — there is no other credential.
   */
  @IsString()
  @MinLength(1, { message: 'accessToken is required' })
  @MaxLength(4096)
  accessToken!: string;

  /**
   * Only a floor is asserted here. The real rules — composition, and the
   * Pwned Passwords lookup — live in PasswordPolicyService so that reset and
   * signup cannot drift apart. Duplicating them in a decorator is how they
   * would.
   */
  @IsString()
  @MinLength(12, { message: 'password must be at least 12 characters' })
  @MaxLength(256)
  password!: string;
}
