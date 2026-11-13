/**
 * SWEEP-P0-SCOPES (browser sweep BUG-001): the webhooks settings page tells a member the server
 * refused them, and never claims a refused write succeeded.
 *
 * The server now holds webhook configuration to the settings module (read to list, write to
 * create, delete, enable/disable or test) and answers a signing secret in the create answer and,
 * afterwards, only to a member with settings admin; a settings read member gets the receiver's
 * origin only (review CR-5, SEC-3; apps/server webhooks.controller.ts). Before: the page treated every answer of delete as
 * success ("Webhook deleted", the row removed), showed a refused create as a generic failure and a
 * refused list as "No webhooks configured", inviting the member to add one; and it relied on the
 * list carrying each webhook's secret.
 *
 * Required: a refused list shows the server's refusal instead of the empty state; a refused
 * create, delete or enable/disable shows the server's refusal and leaves the list as it was; a new
 * webhook's secret is shown with a note that only settings admins can see it again; a listed URL the
 * server masked says the full receiver URL is hidden.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";

const REFUSAL_READ = "Insufficient permissions: settings requires read access (you have none)";
const REFUSAL_WRITE = "Insufficient permissions: settings requires write access (you have read)";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/lib/workspace", () => ({ getStoredBusinessId: () => "biz_1" }));

const client = vi.hoisted(() => ({
  fetchWebhooks: vi.fn(),
  createWebhook: vi.fn(),
  deleteWebhook: vi.fn(),
  testWebhook: vi.fn(),
  fetchWebhookDeliveries: vi.fn(),
  toggleWebhook: vi.fn(),
}));
vi.mock("@/lib/client", () => client);

import WebhooksSettingsPage from "../page";

const OWNER_HOOK = {
  id: "wh_owner",
  name: "Owner ERP",
  url: "https://erp.example.com/hook",
  events: ["invoice.paid"],
  isActive: true,
  createdAt: "2026-11-01T00:00:00.000Z",
};

beforeEach(() => {
  for (const fn of Object.values(client)) fn.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  client.fetchWebhookDeliveries.mockResolvedValue({ data: [], error: null });
});
afterEach(() => cleanup());

describe("webhooks settings page: refusal states", () => {
  it("[WEB-WHK-01] a refused list shows the server's refusal, not the empty state that invites adding a webhook", async () => {
    client.fetchWebhooks.mockResolvedValue({ data: null, error: REFUSAL_READ, status: 403 });
    render(<WebhooksSettingsPage />);
    expect(await screen.findByText(REFUSAL_READ)).toBeInTheDocument();
    expect(screen.queryByText("No webhooks configured")).toBeNull();
    expect(screen.queryByText("Add Your First Webhook")).toBeNull();
  });

  it("[WEB-WHK-02] a refused delete shows the refusal and keeps the webhook listed; it never says 'Webhook deleted'", async () => {
    client.fetchWebhooks.mockResolvedValue({ data: [OWNER_HOOK], error: null });
    client.deleteWebhook.mockResolvedValue({ data: null, error: REFUSAL_WRITE, status: 403 });
    render(<WebhooksSettingsPage />);
    await screen.findByText("Owner ERP");
    fireEvent.click(screen.getByTitle("Delete"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(REFUSAL_WRITE));
    expect(toast.success).not.toHaveBeenCalled();
    expect(screen.getByText("Owner ERP")).toBeInTheDocument();
  });

  it("[WEB-WHK-03] a refused enable/disable shows the server's refusal", async () => {
    client.fetchWebhooks.mockResolvedValue({ data: [OWNER_HOOK], error: null });
    client.toggleWebhook.mockResolvedValue({ data: null, error: REFUSAL_WRITE, status: 403 });
    render(<WebhooksSettingsPage />);
    await screen.findByText("Owner ERP");
    fireEvent.click(screen.getByTitle("Pause"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(REFUSAL_WRITE));
    expect(toast.success).not.toHaveBeenCalled();
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("[WEB-WHK-04] a refused create shows the server's refusal, adds nothing, and never says 'Webhook created'", async () => {
    client.fetchWebhooks.mockResolvedValue({ data: [], error: null });
    client.createWebhook.mockResolvedValue({ data: null, error: REFUSAL_WRITE, status: 403 });
    render(<WebhooksSettingsPage />);
    fireEvent.click(await screen.findByText("Add Your First Webhook"));
    fireEvent.change(screen.getByPlaceholderText(/https:\/\//i), { target: { value: "https://sink.example.com/hook" } });
    fireEvent.click(screen.getByRole("button", { name: /create webhook/i }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(REFUSAL_WRITE));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("[WEB-WHK-05] a created webhook's signing secret is shown with a note that only settings admins can see it again (review CR-5)", async () => {
    client.fetchWebhooks.mockResolvedValue({ data: [], error: null });
    client.createWebhook.mockResolvedValue({
      data: { ...OWNER_HOOK, id: "wh_new", name: "New hook", secret: "a".repeat(64) },
      error: null,
    });
    render(<WebhooksSettingsPage />);
    fireEvent.click(await screen.findByText("Add Your First Webhook"));
    fireEvent.change(screen.getByPlaceholderText(/https:\/\//i), { target: { value: "https://sink.example.com/hook" } });
    fireEvent.click(screen.getByRole("button", { name: /create webhook/i }));
    const card = (await screen.findByText("New hook")).closest("div.p-4") as HTMLElement;
    expect(within(card).getByText(/only members with settings admin can see it again/i)).toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledWith("Webhook created");
  });

  it("[WEB-WHK-06] RED-BEFORE (review SEC-3): a receiver URL the server masked (settings read) is shown as the origin with a note that the full URL is hidden", async () => {
    client.fetchWebhooks.mockResolvedValue({
      data: [{ ...OWNER_HOOK, url: "https://hooks.example.com/***", urlMasked: true }],
      error: null,
    });
    render(<WebhooksSettingsPage />);
    const card = (await screen.findByText("Owner ERP")).closest("div.p-4") as HTMLElement;
    expect(within(card).getByText("https://hooks.example.com/***")).toBeInTheDocument();
    expect(within(card).getByText(/full receiver url is hidden/i)).toBeInTheDocument();
  });
});
