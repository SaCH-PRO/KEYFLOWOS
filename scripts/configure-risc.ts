#!/usr/bin/env tsx
/**
 * Configure Google's Cross-Account Protection (RISC) event stream.
 *
 * Usage:
 *   tsx --env-file .env scripts/configure-risc.ts
 *
 * This script:
 *   1. Builds a signed JWT using a GCP service account key.
 *   2. Calls the RISC stream:update API to register the receiver endpoint.
 *   3. Subscribes to the security event types KeyFlowOS handles.
 *
 * Prerequisite: the service account must have the "RISC Configuration Admin"
 * role (roles/riscconfigs.admin) in the GCP project that owns the Google
 * Sign-In client IDs.
 */

import { GoogleAuth } from 'google-auth-library';

const RISC_STREAM_UPDATE_URL =
  'https://risc.googleapis.com/v1beta/stream:update';
const RISC_MANAGEMENT_AUDIENCE =
  'https://risc.googleapis.com/google.identity.risc.v1beta.RiscManagementService';

const EVENT_TYPES = [
  'https://schemas.openid.net/secevent/risc/event-type/sessions-revoked',
  'https://schemas.openid.net/secevent/oauth/event-type/tokens-revoked',
  'https://schemas.openid.net/secevent/oauth/event-type/token-revoked',
  'https://schemas.openid.net/secevent/risc/event-type/account-disabled',
  'https://schemas.openid.net/secevent/risc/event-type/account-enabled',
  'https://schemas.openid.net/secevent/risc/event-type/account-credential-change-required',
  'https://schemas.openid.net/secevent/risc/event-type/verification',
];

function env(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

function loadServiceAccountCredentials(): Record<string, unknown> {
  const raw = env('RISC_SERVICE_ACCOUNT_JSON').trim();
  if (raw.startsWith('{')) {
    return JSON.parse(raw);
  }
  // Treat as filesystem path.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(require('path').resolve(raw)) as Record<string, unknown>;
}

async function main(): Promise<void> {
  const receiverUrl = env('RISC_RECEIVER_URL');
  if (!receiverUrl.startsWith('https://')) {
    throw new Error('RISC_RECEIVER_URL must be an HTTPS URL');
  }

  const credentials = loadServiceAccountCredentials();
  const auth = new GoogleAuth({ credentials });
  const client = await auth.getClient();

  const token = await client.fetchIdToken(RISC_MANAGEMENT_AUDIENCE);

  const body = {
    delivery: {
      delivery_method:
        'https://schemas.openid.net/secevent/risc/delivery-method/push',
      url: receiverUrl,
    },
    events_requested: EVENT_TYPES,
  };

  const res = await fetch(RISC_STREAM_UPDATE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `RISC stream configuration failed (${res.status} ${res.statusText}): ${text}`,
    );
  }

  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  // eslint-disable-next-line no-console
  console.log('RISC stream configured successfully.');
  // eslint-disable-next-line no-console
  console.log(json);
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
