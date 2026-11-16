/**
 * SWEEP-P0-SCOPES review repair (finding SEC-1): a connector's inbound webhook URL and signing
 * secret (GET /connectors/businesses/:b/webhook-info/:type) and its credential writes now need
 * settings admin on the server. The connect dialog ignored a refused webhook-info read and said
 * "This connector has no credentials to enter."; it now shows the server's refusal.
 *
 * The stand-in is the api client module (a refusal is { data: null, error }, never a throw).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";

const REFUSAL = "Insufficient permissions: settings requires admin access (you have none)";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
const api = vi.hoisted(() => ({ apiGet: vi.fn(), apiPostSimple: vi.fn(), apiDelete: vi.fn() }));
vi.mock("@/lib/api", () => api);

import { ConnectorCredentialDialog } from "../connector-credential-dialog";

const SCHEMA = {
  type: "webhook_form",
  name: "Webhook form",
  connectMode: "webhook",
  authType: "none",
  instructions: null,
  oauthStartPath: null,
  fields: [],
  values: {},
  isConfigured: false,
};

beforeEach(() => {
  api.apiGet.mockReset();
  toast.error.mockReset();
});
afterEach(() => cleanup());

describe("connect dialog: a refused webhook-info read (SEC-1)", () => {
  it("[WEB-CON-01] RED-BEFORE: the dialog shows the server's refusal, not 'no credentials to enter'", async () => {
    api.apiGet.mockImplementation(async (path: string) =>
      path.includes("/webhook-info/") ? { data: null, error: REFUSAL, status: 403 } : { data: SCHEMA, error: null },
    );
    render(<ConnectorCredentialDialog businessId="biz_1" type="webhook_form" open onClose={vi.fn()} onSaved={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(REFUSAL)).toBeInTheDocument());
    expect(screen.queryByText(/has no credentials to enter/i)).toBeNull();
  });
});
