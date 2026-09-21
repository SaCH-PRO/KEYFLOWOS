import { IsString, IsNotEmpty, IsOptional, IsNumber, IsIn } from 'class-validator';

/**
 * KF-EXEC-AUTH-001: `grantorId` is GONE from this DTO, deliberately.
 *
 * It used to be required, and the controller did
 * `grantorId: body.grantorId ?? req.user?.id ?? 'system'` — so the client-supplied
 * value WON over the authenticated caller, and anyone able to reach the route could
 * name any grantor they liked. The schema calls the column "Membership ID who granted",
 * while both fallbacks supplied a User id or the string 'system', so the field was also
 * the wrong type at every write site.
 *
 * It is now derived server-side from the authenticated caller's active Membership in
 * the route's Business, and a request that cannot resolve one is refused. The field is
 * removed rather than ignored: the global ValidationPipe runs with `whitelist: true`,
 * so a client that still sends it has it stripped instead of rejected, which keeps the
 * existing wire contract working while removing the authority it carried.
 */
export class CreateAuthorityGrantDto {
  @IsString()
  @IsIn(['KEY', 'USER'])
  granteeType!: 'KEY' | 'USER';

  @IsString()
  @IsNotEmpty()
  granteeId!: string;

  @IsString()
  @IsIn(['tier4_financial', 'tier4_publishing', 'tier4_operations'])
  scope!: 'tier4_financial' | 'tier4_publishing' | 'tier4_operations';

  @IsNumber()
  @IsOptional()
  maxAmount?: number;

  @IsString()
  @IsOptional()
  validFrom?: string;

  @IsString()
  @IsOptional()
  validUntil?: string;
}
