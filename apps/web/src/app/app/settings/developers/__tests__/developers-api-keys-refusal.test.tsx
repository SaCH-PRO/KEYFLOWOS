/**
 * SWEEP-P0-SCOPES (browser sweep BUG-013): the developers settings page tells a member the server
 * refused them, and never claims a refused API-key write succeeded.
 *
 * The server now holds API keys to the settings module (read to list, admin to create) and keeps
 * revoking a key to the business owner (apps/server api-keys.controller.ts). Before: handleDelete
 * ignored the answer, so a refused revoke said "API key revoked" and removed the key from the
 * list; a refused create closed silently; a refused list read as "No API keys yet".
 *
 * Required: a refused list shows the server's refusal; a refused create or revoke shows the
 * server's refusal, shows no new key, and leaves the list as it was.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

const REFUSAL_READ = "Insufficient permissions: settings requires read access (you have none)";
const REFUSAL_ADMIN = "Insufficient permissions: settings requires admin access (you have write)";
const REFUSAL_OWNER = "Only the business owner can revoke an API key";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/lib/workspace", () => ({ getStoredBusinessId: () => "biz_1" }));

const api = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn(), apiDelete: vi.fn() }));
vi.mock("@/lib/api", () => api);

import DevelopersSettingsPage from "../page";

const OWNER_KEY = {
  id: "key_owner",
  name: "Owner key",
  prefix: "kf_abcde",
  createdAt: "2026-11-01T00:00:00.000Z",
  lastUsed: null,
  scopes: ["contacts:read"],
};

/** The revoke button of the key row that shows `name` (the row's trash button). */
function revokeButtonOf(name: string): HTMLElement {
  const row = screen.getByText(name).closest("div.flex.items-center.justify-between") as HTMLElement;
  const icon = row.querySelector('svg[class*="lucide-trash"]');
  return icon!.closest("button") as HTMLElement;
}

beforeEach(() => {
  api.apiGet.mockReset();
  api.apiPost.mockReset();
  api.apiDelete.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
});
afterEach(() => cleanup());

describe("developers settings page: API key refusal states", () => {
  it("[WEB-AK-01] a refused list shows the server's refusal, not 'No API keys yet'", async () => {
    api.apiGet.mockResolvedValue({ data: null, error: REFUSAL_READ, status: 403 });
    render(<DevelopersSettingsPage />);
    expect(await screen.findByText(REFUSAL_READ)).toBeInTheDocument();
    expect(screen.queryByText("No API keys yet")).toBeNull();
  });

  it("[WEB-AK-02] a refused revoke shows the refusal and keeps the key listed; it never says 'API key revoked'", async () => {
    api.apiGet.mockResolvedValue({ data: { keys: [OWNER_KEY] }, error: null });
    api.apiDelete.mockResolvedValue({ data: null, error: REFUSAL_OWNER, status: 403 });
    render(<DevelopersSettingsPage />);
    await screen.findByText("Owner key");
    fireEvent.click(revokeButtonOf("Owner key"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(REFUSAL_OWNER));
    expect(toast.success).not.toHaveBeenCalled();
    expect(screen.getByText("Owner key")).toBeInTheDocument();
  });

  it("[WEB-AK-03] a refused create shows the server's refusal and no new key", async () => {
    api.apiGet.mockResolvedValue({ data: { keys: [] }, error: null });
    api.apiPost.mockResolvedValue({ data: null, error: REFUSAL_ADMIN, status: 403 });
    render(<DevelopersSettingsPage />);
    await screen.findByText("No API keys yet");
    fireEvent.click(screen.getByRole("button", { name: /create key/i }));
    fireEvent.change(screen.getByPlaceholderText("My Integration"), { target: { value: "Jada key" } });
    fireEvent.click(screen.getByRole("button", { name: /read contacts/i }));
    const createButtons = screen.getAllByRole("button", { name: /^create key$/i });
    fireEvent.click(createButtons[createButtons.length - 1]);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(REFUSAL_ADMIN));
    expect(toast.success).not.toHaveBeenCalled();
    expect(screen.queryByText("API Key Created")).toBeNull();
  });

  it("[WEB-AK-04] a successful revoke removes the key and says so", async () => {
    api.apiGet.mockResolvedValue({ data: { keys: [OWNER_KEY] }, error: null });
    api.apiDelete.mockResolvedValue({ data: { success: true }, error: null });
    render(<DevelopersSettingsPage />);
    await screen.findByText("Owner key");
    fireEvent.click(revokeButtonOf("Owner key"));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("API key revoked"));
    expect(screen.queryByText("Owner key")).toBeNull();
  });
});
