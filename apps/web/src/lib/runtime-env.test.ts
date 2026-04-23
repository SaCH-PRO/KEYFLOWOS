import { describe, expect, it } from "vitest";
import { getApiBase, getSiteUrl } from "./runtime-env";

describe("runtime-env", () => {
  it("uses explicit NEXT_PUBLIC_API_BASE_URL when provided", () => {
    expect(getApiBase("https://api.example.com", "https://app.example.com")).toBe(
      "https://api.example.com",
    );
  });

  it("derives API base from current origin when no env is provided", () => {
    expect(getApiBase(undefined, "https://app.example.com")).toBe("https://app.example.com:3001");
  });

  it("uses localhost fallback when no origin is available", () => {
    expect(getApiBase(undefined, undefined)).toBe("http://localhost:3001");
  });

  it("keeps explicit non-local API base when app runs on localhost", () => {
    expect(getApiBase("https://api.example.com", "http://localhost:5000")).toBe(
      "https://api.example.com",
    );
  });

  it("rewrites stale replit API base to local backend on localhost", () => {
    expect(
      getApiBase(
        "https://d9c92da4-0dde-44b6-a1ad-551bf4dfbe2c-00-39zpddgeqea4v.worf.replit.dev:3001",
        "http://localhost:5000",
      ),
    ).toBe("http://localhost:3001");
  });

  it("uses explicit NEXT_PUBLIC_SITE_URL when present", () => {
    expect(getSiteUrl("https://app.example.com", "https://ignored.example.com")).toBe(
      "https://app.example.com",
    );
  });

  it("derives site url from current origin when env is absent", () => {
    expect(getSiteUrl(undefined, "https://app.example.com")).toBe("https://app.example.com");
  });
});
