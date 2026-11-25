/**
 * WEDGE-WA-INBOUND-CAPTURE (web half, D-263): the "+ New" menu's From WhatsApp door.
 *
 * Every entry point to New (checklist B2):
 *   - the header's New button (app-header.tsx) opens NewEntityMenu;
 *   - the phone bottom bar's New (mobile-bottom-nav-v2.tsx) opens the same header menu (setAddMenuOpen), and so does
 *     the ⌘N shortcut (use-app-layout.ts);
 * so the door is in NewEntityMenu, and NEM-06 pins that the bar's New still opens that menu.
 *
 * The door is offered only to a member who may write customers (crm write or admin: the server refuses a capture
 * without crm write); the level is the shell's (useMemberModuleLevels, GET my-access), and unknown hides nothing.
 *
 *   NEM-01 crm write: the menu lists From WhatsApp, next to the doors it already had.
 *   NEM-02 access unknown (no answer yet, a failed read): From WhatsApp is listed.
 *   NEM-03 crm read or none: From WhatsApp is not listed (the other doors stay).
 *   NEM-04 choosing it opens the New from WhatsApp sheet in place of the menu.
 *   NEM-05 while the sheet is open, the menu's own keys (arrows, Enter) do not move or navigate: typing a message with
 *          line breaks stays in the sheet.
 *   NEM-06 the phone bottom bar's New opens the header's New menu (guard).
 *
 * Review repair COR-4: the menu takes the member's levels from the shell (useAppLayout's moduleLevels, handed down by
 * AppHeader) instead of asking GET my-access again on every open, which started unknown and showed a crm-read member
 * the door for a moment.
 *   NEM-07 levels known as crm read: the door is absent from the first render, and opening the menu sends no my-access
 *          read (nor any other request).
 *   NEM-08 AppHeader hands the shell's levels to the menu: crm read, no door; crm write, the door.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";

type Levels = Partial<Record<string, "none" | "read" | "write" | "admin">> | null;
const state = vi.hoisted(() => ({
  push: vi.fn(),
  levels: null as Partial<Record<string, "none" | "read" | "write" | "admin">> | null,
}));
const fetchMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: state.push, replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/app/command-center",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
vi.mock("@/components/key/key-agent", () => ({ openKey: vi.fn() }));
vi.mock("@/lib/business-settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/business-settings")>()),
  useBusinessSettings: () => ({ businessId: "biz_nem", status: "ready", error: null, sells: "both" }),
}));

import { NewEntityMenu as NewEntityMenuUnderTest } from "../new-entity-menu";
import { MobileBottomNavV2 } from "../mobile-bottom-nav-v2";
import { AppHeader } from "../app-header";

/** The menu as the header mounts it: with the shell's levels (state.levels). */
function NewEntityMenu({ onClose }: { onClose: () => void }) {
  const Menu = NewEntityMenuUnderTest as unknown as (p: { onClose: () => void; levels: Levels }) => React.ReactElement;
  return <Menu onClose={onClose} levels={state.levels} />;
}

const myAccessReads = () => fetchMock.mock.calls.filter(([url]) => String(url).includes("/my-access"));

const onClose = vi.fn();
const fromWhatsApp = () => screen.queryByRole("menuitem", { name: /from whatsapp/i });

beforeEach(() => {
  state.push.mockReset();
  state.levels = null;
  onClose.mockReset();
  window.localStorage.setItem("kf_business_id", "biz_nem");
  // No API in these tests: the bottom bar's operations probe answers "unknown" (it shows every door).
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => {
    throw new TypeError("offline in test");
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("WEDGE-WA-INBOUND-CAPTURE: the New menu's From WhatsApp door", () => {
  it("NEM-01 crm write: From WhatsApp is listed, with the doors the menu already had", () => {
    state.levels = { crm: "write", revenue: "write", bookings: "write" };
    render(<NewEntityMenu onClose={onClose} />);
    expect(fromWhatsApp()).not.toBeNull();
    const labels = screen.getAllByRole("menuitem").map((el) => el.textContent?.replace(/⌘.*/, "").trim());
    expect(labels).toEqual(expect.arrayContaining(["Contact", "Invoice", "Quote", "Booking"]));
  });

  it("NEM-01b crm admin: From WhatsApp is listed", () => {
    state.levels = { crm: "admin" };
    render(<NewEntityMenu onClose={onClose} />);
    expect(fromWhatsApp()).not.toBeNull();
  });

  it("NEM-02 access unknown: From WhatsApp is listed (the server still refuses)", () => {
    state.levels = null;
    render(<NewEntityMenu onClose={onClose} />);
    expect(fromWhatsApp()).not.toBeNull();
  });

  for (const level of ["read", "none"] as const) {
    it(`NEM-03 crm ${level}: From WhatsApp is not listed, the other doors stay`, () => {
      state.levels = { crm: level, revenue: "write" };
      render(<NewEntityMenu onClose={onClose} />);
      expect(fromWhatsApp()).toBeNull();
      expect(screen.getByRole("menuitem", { name: /^invoice/i })).toBeInTheDocument();
    });
  }

  it("NEM-04 choosing it opens the New from WhatsApp sheet in place of the menu", () => {
    state.levels = { crm: "write" };
    render(<NewEntityMenu onClose={onClose} />);
    fireEvent.click(fromWhatsApp()!);
    const sheet = screen.getByRole("dialog", { name: /new from whatsapp/i });
    expect(within(sheet).getByLabelText(/whatsapp number/i)).toBeInTheDocument();
    expect(within(sheet).getByLabelText(/their message/i)).toBeInTheDocument();
    // The menu gave way to the sheet; it is not closed (that would unmount the sheet).
    expect(screen.queryByRole("menu")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(state.push).not.toHaveBeenCalled();
  });

  it("NEM-04b closing the sheet closes the New menu", () => {
    state.levels = { crm: "write" };
    render(<NewEntityMenu onClose={onClose} />);
    fireEvent.click(fromWhatsApp()!);
    const sheet = screen.getByRole("dialog", { name: /new from whatsapp/i });
    fireEvent.click(within(sheet).getAllByRole("button", { name: /^close$/i })[0]);
    expect(onClose).toHaveBeenCalled();
  });

  it("NEM-05 the menu's arrow and Enter keys do nothing while the sheet is open", () => {
    state.levels = { crm: "write" };
    render(<NewEntityMenu onClose={onClose} />);
    fireEvent.click(fromWhatsApp()!);
    const message = within(screen.getByRole("dialog", { name: /new from whatsapp/i })).getByLabelText(/their message/i);
    message.focus();
    for (const key of ["ArrowDown", "ArrowDown", "Enter", "ArrowUp", "Enter"]) {
      const ev = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      message.dispatchEvent(ev);
      expect(ev.defaultPrevented, key).toBe(false);
    }
    expect(state.push).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: /new from whatsapp/i })).toBeInTheDocument();
  });

  it("NEM-06 the phone bottom bar's New opens the header's New menu (the same NewEntityMenu)", () => {
    const setAddMenuOpen = vi.fn();
    render(
      <MobileBottomNavV2
        pathname="/app/command-center"
        mobileDrawerOpen={false}
        setMobileDrawerOpen={vi.fn()}
        notifOpen={false}
        setNotifOpen={vi.fn()}
        unreadCount={0}
        addMenuOpen={false}
        setAddMenuOpen={setAddMenuOpen}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "New" }));
    expect(setAddMenuOpen).toHaveBeenCalledTimes(1);
    const toggle = setAddMenuOpen.mock.calls[0][0] as (open: boolean) => boolean;
    expect(toggle(false)).toBe(true);
  });

  it("NEM-07 levels known as crm read: no door from the first render, and opening sends no my-access read", async () => {
    state.levels = { crm: "read", revenue: "write" };
    const seen: boolean[] = [];
    const Probe = () => {
      seen.push(screen.queryByRole("menuitem", { name: /from whatsapp/i }) !== null);
      return null;
    };
    render(<><NewEntityMenu onClose={onClose} /><Probe /></>);
    expect(fromWhatsApp()).toBeNull();
    await new Promise((r) => setTimeout(r, 50));
    expect(fromWhatsApp()).toBeNull();
    expect(seen.every((shown) => !shown)).toBe(true);
    expect(myAccessReads()).toEqual([]);
  });

  for (const [level, offered] of [["read", false], ["write", true]] as const) {
    it(`NEM-08 AppHeader hands the shell's levels to the menu: crm ${level} ${offered ? "offers" : "hides"} the door`, async () => {
      const Header = AppHeader as unknown as (p: Record<string, unknown>) => React.ReactElement;
      render(
        <Header
          setMobileDrawerOpen={vi.fn()}
          copilotModule="cockpit"
          addMenuOpen
          setAddMenuOpen={vi.fn()}
          notifications={[]}
          unreadCount={0}
          notifOpen={false}
          setNotifOpen={vi.fn()}
          notifRef={{ current: null }}
          markAllRead={vi.fn()}
          displayName="Owner"
          initials="OW"
          avatarUrl={null}
          isAdminUser={false}
          userMenuOpen={false}
          setUserMenuOpen={vi.fn()}
          userMenuRef={{ current: null }}
          handleLogout={vi.fn()}
          moduleLevels={{ crm: level }}
        />,
      );
      expect(await screen.findByRole("menu")).toBeInTheDocument();
      expect(fromWhatsApp() !== null).toBe(offered);
      await new Promise((r) => setTimeout(r, 50));
      expect(fromWhatsApp() !== null).toBe(offered);
      expect(myAccessReads()).toEqual([]);
    });
  }
});
