import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import {
  checkUsernameAvailability,
  validateUsernameFormat,
  USERNAME_MIN_LENGTH,
  USERNAME_MAX_LENGTH,
} from "@/lib/username-availability";

const API_BASE = "http://localhost:3001";

describe("validateUsernameFormat", () => {
  it("rejects empty strings", () => {
    expect(validateUsernameFormat("")).toEqual({
      valid: false,
      error: "Username is required.",
    });
  });

  it("rejects usernames below minimum length", () => {
    expect(validateUsernameFormat("a")).toEqual({
      valid: false,
      error: `Username must be at least ${USERNAME_MIN_LENGTH} characters.`,
    });
  });

  it("rejects usernames above maximum length", () => {
    expect(validateUsernameFormat("a".repeat(USERNAME_MAX_LENGTH + 1))).toEqual({
      valid: false,
      error: `Username must be no more than ${USERNAME_MAX_LENGTH} characters.`,
    });
  });

  it("rejects invalid characters", () => {
    expect(validateUsernameFormat("john doe")).toEqual({
      valid: false,
      error: "Username can only contain letters, numbers, dots, underscores, and hyphens.",
    });
  });

  it("accepts valid usernames", () => {
    expect(validateUsernameFormat("john_doe")).toEqual({ valid: true });
    expect(validateUsernameFormat("jane.doe-123")).toEqual({ valid: true });
  });
});

describe("checkUsernameAvailability", () => {
  let fetchSpy: MockInstance<typeof fetch>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(global, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("returns 'available' when the API reports available", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ available: true }), { status: 200 }),
    );

    const result = await checkUsernameAvailability("johndoe");

    expect(result).toEqual({ status: "available", available: true });
    expect(fetchSpy).toHaveBeenCalledWith(
      `${API_BASE}/identity/check-username?username=johndoe`,
      { signal: undefined },
    );
  });

  it("returns 'taken' when the API reports taken", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ available: false }), { status: 200 }),
    );

    const result = await checkUsernameAvailability("johndoe");

    expect(result).toEqual({ status: "taken", available: false });
  });

  it("returns 'unknown' for non-OK responses", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("Internal Server Error", { status: 500 }));

    const result = await checkUsernameAvailability("johndoe");

    expect(result).toEqual({ status: "unknown", available: null });
  });

  it("returns 'unknown' for unparseable JSON", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("not json", { status: 200 }));

    const result = await checkUsernameAvailability("johndoe");

    expect(result).toEqual({ status: "unknown", available: null });
  });

  it("returns 'unknown' for malformed response objects", async () => {
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));

    const result = await checkUsernameAvailability("johndoe");

    expect(result).toEqual({ status: "taken", available: false });
  });

  it("returns 'unknown' when fetch throws", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("Network error"));

    const result = await checkUsernameAvailability("johndoe");

    expect(result).toEqual({ status: "unknown", available: null });
  });

  it("returns 'unknown' for invalid format without calling the API", async () => {
    const result = await checkUsernameAvailability("a");

    expect(result).toEqual({ status: "unknown", available: null });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("propagates AbortError when the request is aborted", async () => {
    fetchSpy.mockRejectedValueOnce(Object.assign(new Error("Aborted"), { name: "AbortError" }));

    await expect(checkUsernameAvailability("johndoe")).rejects.toMatchObject({
      name: "AbortError",
      message: "Aborted",
    });
  });
});
