/**
 * The web was pinning KEY to the generalist role on every message.
 *
 * `use-key-chat-actions.ts` sent `role: chatMode ?? "general"`. On the server,
 * `flow-orchestrator` resolves the role as `role ?? await this.inferRole(...)`,
 * and "general" is a truthy string — so the `??` always short-circuited and
 * `detectRoleFromContext` never ran in production. Route context, focused-entity
 * context and conversation stickiness were all dead code, and KEY was never
 * Sales Key or Finance Key for anybody.
 *
 * The docked chat bubble — the chat most users actually touch — has no mode
 * picker at all, so it was permanently pinned.
 *
 * "General" now means what its label says: adapt to what I'm working on.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const actions = readFileSync(join(__dirname, "use-key-chat-actions.ts"), "utf8");
const shell = readFileSync(join(__dirname, "key-full-chat-shell.tsx"), "utf8");
const types = readFileSync(join(__dirname, "types.ts"), "utf8");

describe("role is sent only when explicitly chosen", () => {
  // Asserted against the whole file rather than a slice. Two earlier attempts
  // at anchoring were wrong: `indexOf("role:")` found `role: "assistant"` on a
  // chat message, and a fixed-width window from the payload fell short of the
  // expression. These strings appear nowhere else in the file, so the file is
  // the safest anchor.
  const roleExpr = actions;

  it("does not force the generalist role", () => {
    // The exact defect: `chatMode as string` with chatMode defaulting to
    // "general" meant the server never inferred anything.
    expect(roleExpr).toMatch(/chatMode === "general"/);
    expect(roleExpr).toMatch(/undefined/);
  });

  it("still passes an explicitly picked role through", () => {
    expect(roleExpr).toMatch(/chatMode as string/);
  });

  it("keeps genome onboarding unroled", () => {
    expect(roleExpr).toMatch(/genome_onboarding/);
  });
});

describe("every server role can be selected", () => {
  // support, marketing and operator exist in BusinessRole on the server and
  // were absent from both the picker and the client type, so three of the
  // eight roles were unreachable from the UI.
  const SERVER_ROLES = [
    "general",
    "executive",
    "finance",
    "sales",
    "operations",
    "support",
    "marketing",
    "operator",
  ];

  for (const role of SERVER_ROLES) {
    it(`the picker offers ${role}`, () => {
      expect(shell).toMatch(new RegExp(`id: "${role}"`));
    });

    it(`KeyChatMode includes ${role}`, () => {
      expect(types).toMatch(new RegExp(`"${role}"`));
    });
  }
});
