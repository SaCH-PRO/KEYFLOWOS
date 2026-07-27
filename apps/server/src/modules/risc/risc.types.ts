/**
 * Cross-Account Protection (RISC) event shapes.
 *
 * These types intentionally expose only the fields Google sends in security
 * event tokens. See https://accounts.google.com/.well-known/risc-configuration
 */

export interface RiscSubject {
  subject_type: string;
  iss?: string;
  sub?: string;
  email?: string;
}

export interface RiscEventPayload {
  iss: string;
  aud: string | string[];
  iat: number;
  jti: string;
  events: Record<string, RiscEventDetails>;
}

export interface RiscEventDetails {
  subject: RiscSubject;
  reason?: string;
  state?: string;
}

export interface RiscDiscoveryDocument {
  issuer: string;
  jwks_uri: string;
  [key: string]: unknown;
}

export const RISC_EVENT_TYPES = {
  SESSIONS_REVOKED: 'https://schemas.openid.net/secevent/risc/event-type/sessions-revoked',
  TOKENS_REVOKED: 'https://schemas.openid.net/secevent/oauth/event-type/tokens-revoked',
  TOKEN_REVOKED: 'https://schemas.openid.net/secevent/oauth/event-type/token-revoked',
  ACCOUNT_DISABLED: 'https://schemas.openid.net/secevent/risc/event-type/account-disabled',
  ACCOUNT_ENABLED: 'https://schemas.openid.net/secevent/risc/event-type/account-enabled',
  ACCOUNT_CREDENTIAL_CHANGE_REQUIRED:
    'https://schemas.openid.net/secevent/risc/event-type/account-credential-change-required',
  VERIFICATION: 'https://schemas.openid.net/secevent/risc/event-type/verification',
} as const;

export const RISC_DISABLED_REASON = {
  HIJACKING: 'hijacking',
  BULK_ACCOUNT: 'bulk-account',
} as const;
