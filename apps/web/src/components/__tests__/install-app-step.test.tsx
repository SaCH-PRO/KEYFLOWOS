// @vitest-environment-options {"url": "https://app.keyflowos.test/app/settings/notifications"}
/**
 * OWNER-ALERTS-WEB: the "install on your phone" step (D-154: alerts reach the owner by phone push first; on an
 * iPhone a web app can receive push only once it is added to the Home Screen). manifest.ts (display standalone) and
 * public/sw.js (push and notificationclick handlers) already make the app installable; this step tells the owner
 * whether it is installed on this device and how to install it, in every browser state.
 *
 *   ISA-01  RED-BEFORE  running installed (display-mode standalone) says it is installed and offers no button
 *   ISA-02  RED-BEFORE  a browser that offers install (beforeinstallprompt) gets an Install button; the browser's own
 *                       mini-bar is held back (preventDefault); accepting says it is installed
 *   ISA-03  RED-BEFORE  dismissing the browser's prompt says it was not installed, and falls back to the menu steps
 *                       (the prompt can be used only once)
 *   ISA-04  RED-BEFORE  iPhone Safari (no install prompt) gets Share > Add to Home Screen, and why (push on iPhone)
 *   ISA-05  RED-BEFORE  any other browser without a prompt gets the browser-menu steps, no dead button
 *   ISA-06  RED-BEFORE  the browser's appinstalled event says it is installed
 *   ISA-07  RED-BEFORE  a prompt the browser offered before this step mounted is still used (held at module load)
 *   ISA-08  RED-BEFORE  iOS home-screen mode (navigator.standalone) counts as installed
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const FIREFOX = "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0";

function setUA(ua: string) {
  Object.defineProperty(window.navigator, "userAgent", { value: ua, configurable: true });
}

function standalone(on: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: on && query.includes("display-mode: standalone"),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

/** A beforeinstallprompt event as Chromium fires it. */
function installPromptEvent(outcome: "accepted" | "dismissed") {
  const event = new Event("beforeinstallprompt", { cancelable: true }) as Event & {
    prompt: ReturnType<typeof vi.fn>;
    userChoice: Promise<{ outcome: string; platform: string }>;
  };
  event.prompt = vi.fn(async () => undefined);
  event.userChoice = Promise.resolve({ outcome, platform: "web" });
  return event;
}

async function load() {
  vi.resetModules();
  return import("@/components/install-app-step");
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete (window.navigator as unknown as Record<string, unknown>).userAgent;
  delete (window.navigator as unknown as Record<string, unknown>).standalone;
});

describe("OWNER-ALERTS-WEB: install KEYFLOWOS on your phone", () => {
  it("ISA-01 RED-BEFORE: installed (standalone) says so and offers no button", async () => {
    standalone(true);
    const { InstallAppStep } = await load();
    render(<InstallAppStep />);
    expect(await screen.findByText(/installed on this device/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /install/i })).toBeNull();
  });

  it("ISA-02 RED-BEFORE: an install prompt gets an Install button; accepted says installed", async () => {
    standalone(false);
    setUA("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36");
    const { InstallAppStep } = await load();
    render(<InstallAppStep />);
    const event = installPromptEvent("accepted");
    act(() => { window.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(true);
    const button = await screen.findByRole("button", { name: /install app/i });
    await act(async () => { fireEvent.click(button); });
    expect(event.prompt).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/installed on this device/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /install app/i })).toBeNull();
  });

  it("ISA-03 RED-BEFORE: a dismissed prompt says not installed and falls back to the menu steps", async () => {
    standalone(false);
    setUA(FIREFOX);
    const { InstallAppStep } = await load();
    render(<InstallAppStep />);
    const event = installPromptEvent("dismissed");
    act(() => { window.dispatchEvent(event); });
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: /install app/i })); });
    expect(await screen.findByText(/not installed/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /install app/i })).toBeNull();
    expect(screen.getByText(/browser's menu/i)).toBeTruthy();
    expect(screen.queryByText(/installed on this device/i)).toBeNull();
  });

  it("ISA-04 RED-BEFORE: iPhone Safari gets Share > Add to Home Screen, and why", async () => {
    standalone(false);
    setUA(IPHONE);
    const { InstallAppStep } = await load();
    render(<InstallAppStep />);
    expect(await screen.findByText(/add to home screen/i)).toBeTruthy();
    expect(screen.getByText(/share/i)).toBeTruthy();
    expect(screen.getByText(/iphone.*only.*home screen|home screen.*iphone/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /install/i })).toBeNull();
  });

  it("ISA-05 RED-BEFORE: another browser without a prompt gets the browser-menu steps and no button", async () => {
    standalone(false);
    setUA(FIREFOX);
    const { InstallAppStep } = await load();
    render(<InstallAppStep />);
    expect(await screen.findByText(/browser's menu/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /install/i })).toBeNull();
    expect(screen.queryByText(/installed on this device/i)).toBeNull();
  });

  it("ISA-06 RED-BEFORE: the appinstalled event says it is installed", async () => {
    standalone(false);
    setUA(FIREFOX);
    const { InstallAppStep } = await load();
    render(<InstallAppStep />);
    await screen.findByText(/browser's menu/i);
    act(() => { window.dispatchEvent(new Event("appinstalled")); });
    await waitFor(() => expect(screen.getByText(/installed on this device/i)).toBeTruthy());
  });

  it("ISA-07 RED-BEFORE: a prompt offered before the step mounted is still used", async () => {
    standalone(false);
    setUA(FIREFOX);
    const { InstallAppStep } = await load();
    const event = installPromptEvent("accepted");
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    render(<InstallAppStep />);
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: /install app/i })); });
    expect(event.prompt).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/installed on this device/i)).toBeTruthy();
  });

  it("ISA-08 RED-BEFORE: iOS home-screen mode (navigator.standalone) counts as installed", async () => {
    standalone(false);
    setUA(IPHONE);
    Object.defineProperty(window.navigator, "standalone", { value: true, configurable: true });
    const { InstallAppStep } = await load();
    render(<InstallAppStep />);
    expect(await screen.findByText(/installed on this device/i)).toBeTruthy();
    expect(screen.queryByText(/add to home screen/i)).toBeNull();
  });
});
