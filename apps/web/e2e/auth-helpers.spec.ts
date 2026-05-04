import { test, expect } from "@playwright/test";
import { deriveOAuthName } from "../src/app/auth/callback/page";
import { parseRecoveryHash } from "../src/app/auth/reset-password/page";

test.describe("deriveOAuthName", () => {
  test("prefers given_name + family_name when present", () => {
    const r = deriveOAuthName({ given_name: "Ada", family_name: "Lovelace", full_name: "Ignored" });
    expect(r).toEqual({ firstName: "Ada", lastName: "Lovelace", fullName: "Ignored" });
  });

  test("falls back to splitting full_name on whitespace", () => {
    const r = deriveOAuthName({ full_name: "Grace Brewster Hopper" });
    expect(r.firstName).toBe("Grace");
    expect(r.lastName).toBe("Brewster Hopper");
  });

  test("handles single-token mononyms with empty last name", () => {
    const r = deriveOAuthName({ name: "Cher" });
    expect(r).toEqual({ firstName: "Cher", lastName: "", fullName: "Cher" });
  });

  test("returns empty strings when metadata is null/missing", () => {
    expect(deriveOAuthName(null)).toEqual({ firstName: "", lastName: "", fullName: "" });
    expect(deriveOAuthName(undefined)).toEqual({ firstName: "", lastName: "", fullName: "" });
    expect(deriveOAuthName({})).toEqual({ firstName: "", lastName: "", fullName: "" });
  });

  test("trims leading/trailing whitespace on given/family names", () => {
    const r = deriveOAuthName({ given_name: "  Ada  ", family_name: "  Lovelace  " });
    expect(r.firstName).toBe("Ada");
    expect(r.lastName).toBe("Lovelace");
  });

  test("ignores non-string metadata values", () => {
    const r = deriveOAuthName({ given_name: 42, family_name: null, full_name: "Alan Turing" } as Record<string, unknown>);
    expect(r).toEqual({ firstName: "Alan", lastName: "Turing", fullName: "Alan Turing" });
  });
});

test.describe("parseRecoveryHash", () => {
  test("extracts the access_token when type=recovery", () => {
    const r = parseRecoveryHash("#access_token=abc123&type=recovery");
    expect(r).toEqual({ status: "ready", token: "abc123" });
  });

  test("rejects when type is not recovery", () => {
    const r = parseRecoveryHash("#access_token=abc123&type=signup");
    expect(r.status).toBe("invalid");
  });

  test("rejects when access_token is missing", () => {
    const r = parseRecoveryHash("#type=recovery");
    expect(r.status).toBe("invalid");
  });

  test("surfaces error_description when present", () => {
    const r = parseRecoveryHash("#error_description=Link+expired");
    expect(r).toEqual({ status: "invalid", error: "Link expired" });
  });

  test("handles missing/null/empty hash defensively", () => {
    expect(parseRecoveryHash(null).status).toBe("invalid");
    expect(parseRecoveryHash(undefined).status).toBe("invalid");
    expect(parseRecoveryHash("").status).toBe("invalid");
  });

  test("strips a leading `#` if present", () => {
    const r = parseRecoveryHash("access_token=xyz&type=recovery");
    expect(r).toEqual({ status: "ready", token: "xyz" });
  });
});
