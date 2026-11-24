/**
 * NAV-A3 (sweep BUG-118): "My account" opens the member's own account; "Business profile" stays the business's page.
 *
 * Before: /app/settings/profile replaced itself with /app/profile (the business profile and Genome), and the
 * header's "My Profile", the phone drawer's name link and the Me nav's "Profile" all opened /app/profile. A team
 * member asking for their own account landed on the business's page (journey J9).
 *
 * After: /app/settings/profile is the account page. It reads GET /identity/me, shows the member's own name and email,
 * and saves the member's own details with PATCH /identity/me (the server's UpdateUserDto: firstName, lastName, name,
 * phone; the stub refuses what that DTO refuses). Every "my account" link opens it. Only `fetch` and the router are stubbed.
 * Cases tagged RED-BEFORE fail on the packet's base (f6764f4c); CONTROL cases pass on both.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/app/settings/profile",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));
vi.mock("@/components/key/key-agent", () => ({ openKey: vi.fn() }));
// The upload itself is not under test: it hands back a storage path, as lib uploads do ("/objects/...").
vi.mock("@/hooks/use-upload", () => ({ useUpload: () => ({ uploadFile: async () => ({ objectPath: "/objects/uploads/me.png" }), isUploading: false }) }));
vi.mock("@/components/layout/new-entity-menu", () => ({ NewEntityMenu: () => null }));
vi.mock("@/components/layout/operations-nav", () => ({
  navItemsForOperationsAccess: (items: unknown[]) => items,
  sectionsForOperationsAccess: (sections: unknown[]) => sections,
  useOperationsAccess: () => ({ level: "full", loading: false }),
}));

const ME = { id: "usr_staff", email: "shanice.staff@example.com", name: "Shanice", firstName: "Shanice", lastName: "Ali", phone: null, avatarUrl: null, role: "USER" };

/**
 * What the server's UpdateUserDto and ValidationPipe refuse (apps/server/src/modules/identity/dto/update-user.dto.ts):
 * @IsOptional skips only null and undefined, so an empty phone meets @IsPhoneNumber and is refused; avatarUrl must be a
 * full URL (@IsUrl); null phone passes validation but IdentityService.updateUser trims it and fails (500).
 */
function dtoRefusal(body: Record<string, unknown>): string | null {
  if ("phone" in body && body.phone !== undefined) {
    if (body.phone === null) return "phone null (the service trims it: 500)";
    if (!/^\+\d{8,15}$/.test(String(body.phone))) return "phone must be a valid phone number";
  }
  if ("avatarUrl" in body && body.avatarUrl !== undefined && !/^https?:\/\//.test(String(body.avatarUrl))) return "avatarUrl must be a valid URL";
  for (const k of Object.keys(body)) if (!["firstName", "lastName", "name", "phone", "avatarUrl"].includes(k)) return `property ${k} should not exist`;
  return null;
}

interface Sent { method: string; path: string; body: unknown }
function jsonResponse(status: number, body: unknown): Response {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => JSON.parse(text) as unknown,
    text: async () => text,
    clone() { return jsonResponse(status, body); },
  } as unknown as Response;
}
function serve(me: { status: number; body: unknown } = { status: 200, body: ME }) {
  const sent: Sent[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const { pathname } = new URL(url, "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
    sent.push({ method, path: pathname, body });
    if (pathname.endsWith("/identity/me") && method === "GET") return jsonResponse(me.status, me.body);
    if (pathname.endsWith("/identity/me") && method === "PATCH") {
      const refusal = dtoRefusal(body as Record<string, unknown>);
      if (refusal) return jsonResponse(400, { statusCode: 400, message: [refusal], error: "Bad Request" });
      return jsonResponse(200, { ...ME, ...(body as object) });
    }
    return jsonResponse(404, { message: "Not Found" });
  }));
  return sent;
}

async function renderAccountPage() {
  const { default: Page } = await import("@/app/app/settings/profile/page");
  return render(<Page />);
}

beforeEach(() => {
  router.replace.mockClear();
  router.push.mockClear();
  window.localStorage.setItem("kf_business_id", "biz_a3");
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("NAV-A3: /app/settings/profile is the member's own account", () => {
  it("RED-BEFORE (BUG-118): it stays on the page; it does not send the member to the business profile", async () => {
    serve();
    await renderAccountPage();
    await new Promise((r) => setTimeout(r, 50));
    expect(router.replace).not.toHaveBeenCalledWith("/app/profile");
    expect(router.push).not.toHaveBeenCalledWith("/app/profile");
  });

  it("RED-BEFORE (BUG-118): it shows the member's own name and email, and nothing of the business's profile", async () => {
    serve();
    const { container } = await renderAccountPage();
    expect(await screen.findByRole("heading", { name: /my account/i })).toBeTruthy();
    await waitFor(() => expect(container.textContent).toContain(ME.email));
    expect((screen.getByLabelText(/first name/i) as HTMLInputElement).value).toBe("Shanice");
    expect(container.textContent ?? "").not.toMatch(/business (profile|intelligence)|genome/i);
  });

  it("RED-BEFORE (BUG-118): Save sends the member's own details to PATCH /identity/me, once", async () => {
    const sent = serve();
    await renderAccountPage();
    const display = await screen.findByLabelText(/display name/i);
    fireEvent.change(display, { target: { value: "Shan" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(sent.filter((r) => r.method === "PATCH")).toHaveLength(1));
    const patch = sent.find((r) => r.method === "PATCH")!;
    expect(patch.path).toMatch(/\/identity\/me$/);
    // Review MAJOR-2: only what changed is sent; an empty phone is never sent (the server refuses "" with a 400).
    expect(patch.body).toEqual({ name: "Shan" });
    expect(await screen.findByText(/profile updated/i)).toBeTruthy();
  });

  it("RED-BEFORE (review MAJOR-2): a member with no phone can save a new name; the server accepts the body", async () => {
    const sent = serve();
    await renderAccountPage();
    fireEvent.change(await screen.findByLabelText(/last name/i), { target: { value: "Ali-Mohammed" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(await screen.findByText(/profile updated/i)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(sent.find((r) => r.method === "PATCH")!.body).toEqual({ lastName: "Ali-Mohammed" });
  });

  it("RED-BEFORE (review MAJOR-2): a phone the member types is sent alone, and a refusal is shown, not swallowed", async () => {
    const sent = serve();
    await renderAccountPage();
    fireEvent.change(await screen.findByLabelText(/phone/i), { target: { value: "868-620-1234" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/phone/i);
    expect(sent.find((r) => r.method === "PATCH")!.body).toEqual({ phone: "868-620-1234" });
  });

  it("RED-BEFORE (review MINOR-3): a photo the server refuses says so", async () => {
    serve();
    await renderAccountPage();
    const input = await screen.findByLabelText(/upload profile picture/i);
    fireEvent.change(input, { target: { files: [new File(["x"], "me.png", { type: "image/png" })] } });
    expect((await screen.findByRole("alert")).textContent).toMatch(/photo|avatar|url/i);
  });

  it("RED-BEFORE (BUG-118): a read that fails says so; it is not shown as an empty account", { timeout: 10_000 }, async () => {
    serve({ status: 503, body: { message: "Service Unavailable" } });
    await renderAccountPage();
    // A plain 503 is retried (lib/fetch-with-retry.ts: three retries, about 2 s) before the read gives up.
    expect(await screen.findByRole("alert", {}, { timeout: 6_000 })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /save/i })).toBeNull();
  });
});

describe("NAV-A3: every 'my account' link opens the account page", () => {
  it("RED-BEFORE (BUG-118): the Me nav names My account and opens /app/settings/profile", async () => {
    const { meNav } = await import("@/lib/nav-config");
    const mine = meNav.find((i) => /account|profile/i.test(i.label));
    expect(mine).toMatchObject({ label: "My account", href: "/app/settings/profile" });
  });

  it("CONTROL: Business profile still opens the business's page (/app/profile)", async () => {
    const { hubNav } = await import("@/lib/nav-config");
    const all = JSON.stringify(hubNav);
    expect(all).toContain('"label":"Business profile","href":"/app/profile"');
  });

  it("RED-BEFORE (BUG-118): the header's account menu offers My account, opening /app/settings/profile", async () => {
    serve();
    const { AppHeader } = await import("@/components/layout/app-header");
    render(
      <AppHeader
        setMobileDrawerOpen={vi.fn()}
        copilotModule={"general" as never}
        addMenuOpen={false}
        setAddMenuOpen={vi.fn()}
        notifications={[]}
        unreadCount={0}
        notifOpen={false}
        setNotifOpen={vi.fn()}
        notifRef={{ current: null }}
        markAllRead={async () => {}}
        displayName="Shanice"
        initials="SA"
        avatarUrl={null}
        isAdminUser={false}
        userMenuOpen
        setUserMenuOpen={vi.fn()}
        userMenuRef={{ current: null }}
        handleLogout={vi.fn()}
      />,
    );
    const menu = screen.getByRole("menu");
    const item = within(menu).getByRole("menuitem", { name: /my account/i });
    expect(item.getAttribute("href")).toBe("/app/settings/profile");
    expect(within(menu).queryAllByRole("menuitem").map((m) => m.getAttribute("href"))).not.toContain("/app/profile");
  });

  it("RED-BEFORE (BUG-118): the phone drawer's name link opens /app/settings/profile", async () => {
    serve();
    const { MobileDrawer } = await import("@/components/layout/mobile-drawer");
    render(
      <MobileDrawer
        mobileDrawerOpen
        setMobileDrawerOpen={vi.fn()}
        pathname="/app/command-center"
        displayName="Shanice"
        initials="SA"
        avatarUrl={null}
        visibleOperateSections={[]}
        visibleBuildSections={[]}
        visibleMoreNav={[]}
        meNav={[]}
        isSecondaryActive={() => false}
        isFeatureLocked={() => false}
        connectorAlertCount={0}
        isAdminUser={false}
        setKfStoreOpen={vi.fn()}
        handleLogout={vi.fn()}
      />,
    );
    const nameLink = screen.getAllByRole("link").find((a) => (a.textContent ?? "").includes("Shanice"));
    expect(nameLink?.getAttribute("href")).toBe("/app/settings/profile");
    // Review MAJOR-1: on a phone the header's account menu is hidden, so this link is how J9 finds "My account".
    expect(screen.getByRole("link", { name: /my account/i }).getAttribute("href")).toBe("/app/settings/profile");
  });
});
