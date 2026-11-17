/**
 * FAILURE-KIT (re-cut v1 plan, step 3, lane web): <NoAccessState>, the one no-access state.
 *
 * WHY this test exists: a refused read used to fall through to the screen's empty values. A STAFF member without
 * team read opened Settings > Team and saw "0 owner 0 admin 0 staff", "No Team Members Yet" and an active Invite
 * button (BUG-063); without expenses read, Expenses showed "Spent this month TTD $0.00" and "No expenses found"
 * while the owner had TTD 1,250 (BUG-064). Journey J6 requires a refused screen to say "No access, ask the owner",
 * never zeros. The kit's readState() tells a screen which of three it has (data, no access, a failed load), and
 * <NoAccessState> is what it shows for no access.
 *
 * Required here:
 *   - a 403 read refusal, answered by the real transport, renders "No access - ask the owner" with why, and no '0',
 *     no empty-list copy and no create button (RED: no kit, so the screen's `?? 0` renders '0');
 *   - a BusinessGuard 403 ("Unable to verify business access") is a failed load, said as such, not "no access" and
 *     not '0'; a success still shows the data;
 *   - the component says "No access - ask the owner" in every variant, with a default line when given no reason.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { useEffect, useState } from "react";
import { render, screen, cleanup, waitFor } from "@testing-library/react";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), message: vi.fn(), warning: vi.fn(), info: vi.fn(), loading: vi.fn(), dismiss: vi.fn() }),
  Toaster: () => null,
}));

import { apiGet } from "@/lib/api";
import { moduleReadRefusal } from "@/lib/module-access";
import { readState, type ReadState } from "@/lib/failure-kit";
import { NoAccessState, NO_ACCESS_TITLE } from "../no-access-state";

const TEAM_READ_REFUSAL = "Insufficient permissions: team requires read access (you have none)";

function stubGet(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify(body), {
        status,
        statusText: status === 403 ? "Forbidden" : "OK",
        headers: { "content-type": "application/json" },
      }),
    ),
  );
}

type Dashboard = { owners: number; admins: number; staff: number; members: { id: string; name: string }[] };

/** The shape of Settings > Team's summary (BUG-063) with the kit adopted: data, no access, or a failed load. */
function TeamSummary() {
  const [state, setState] = useState<{ read: ReadState; data: Dashboard | null } | null>(null);
  useEffect(() => {
    void apiGet<Dashboard>("/identity/businesses/biz_fk/team/dashboard").then((res) =>
      setState({ read: readState(res, { what: "your team" }), data: res.data }),
    );
  }, []);
  if (!state) return <p>Loading</p>;
  if (state.read.kind === "no-access") return <NoAccessState message={state.read.message} />;
  if (state.read.kind === "failed") return <p role="alert">{state.read.message}</p>;
  const d = state.data;
  return (
    <div>
      <p>
        {d?.owners ?? 0} owner {d?.admins ?? 0} admin {d?.staff ?? 0} staff
      </p>
      {d && d.members.length > 0 ? d.members.map((m) => <p key={m.id}>{m.name}</p>) : <p>No Team Members Yet</p>}
      <button type="button">Invite</button>
    </div>
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("FAILURE-KIT <NoAccessState>: a refused read says no access, never zeros (BUG-063, BUG-064, journey J6)", () => {
  it("[FK-NA-01] RED-BEFORE: a 403 read refusal from the real transport renders 'No access - ask the owner' with why, and no '0', no empty-list copy, no Invite", async () => {
    stubGet(403, { statusCode: 403, message: TEAM_READ_REFUSAL, error: "Forbidden" });
    render(<TeamSummary />);
    await waitFor(() => expect(screen.getByText(NO_ACCESS_TITLE)).toBeInTheDocument());
    expect(NO_ACCESS_TITLE).toMatch(/no access/i);
    expect(NO_ACCESS_TITLE).toMatch(/ask the owner/i);
    const state = screen.getByRole("status");
    expect(state).toHaveTextContent(moduleReadRefusal({ status: 403, error: TEAM_READ_REFUSAL }, "team", "your team")!);
    expect(state).toHaveTextContent("You don't have access to your team in this business.");
    expect(document.body.textContent).not.toMatch(/\b0\b/);
    expect(screen.queryByText(/no team members yet/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /invite/i })).not.toBeInTheDocument();
  });

  it("[FK-NA-02] a BusinessGuard 403 is a failed load, said as such: not 'no access', not '0'", async () => {
    stubGet(403, { statusCode: 403, message: "Unable to verify business access", error: "Forbidden" });
    render(<TeamSummary />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load your team: Unable to verify business access"));
    expect(screen.queryByText(NO_ACCESS_TITLE)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\b0\b/);
  });

  it("[FK-NA-03] a read that goes through still shows the data", async () => {
    stubGet(200, { owners: 1, admins: 0, staff: 2, members: [{ id: "m1", name: "Jada" }] });
    render(<TeamSummary />);
    await waitFor(() => expect(screen.getByText("Jada")).toBeInTheDocument());
    expect(screen.getByText("1 owner 0 admin 2 staff")).toBeInTheDocument();
    expect(screen.queryByText(NO_ACCESS_TITLE)).not.toBeInTheDocument();
  });

  it("[FK-NA-04] says 'No access - ask the owner' in every variant, with a default line naming what when given no reason", () => {
    for (const variant of ["default", "compact", "inline"] as const) {
      const { unmount } = render(<NoAccessState variant={variant} what="expenses" />);
      const state = screen.getByRole("status");
      expect(state).toHaveTextContent(NO_ACCESS_TITLE);
      expect(state).toHaveTextContent("You don't have access to expenses in this business.");
      expect(state).toHaveAttribute("data-state", "no-access");
      expect(state.querySelector("button")).toBeNull();
      unmount();
    }
    render(<NoAccessState />);
    expect(screen.getByRole("status")).toHaveTextContent("You don't have access to this in this business.");
  });
});
