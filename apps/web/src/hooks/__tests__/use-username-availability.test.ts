import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useUsernameAvailability } from "@/hooks/use-username-availability";

const API_BASE = "http://localhost:3001";

describe("useUsernameAvailability", () => {
  let fetchSpy: MockInstance<typeof fetch>;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchSpy = vi.spyOn(global, "fetch");
  });

  afterEach(() => {
    vi.useRealTimers();
    fetchSpy.mockRestore();
  });

  it("starts idle and transitions to available after debounce", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ available: true }), { status: 200 }),
    );

    const { result } = renderHook(() => useUsernameAvailability());

    expect(result.current.status).toBe("idle");

    act(() => {
      result.current.check("johndoe");
    });

    expect(result.current.status).toBe("checking");

    act(() => {
      vi.advanceTimersByTime(300);
    });

    await waitFor(() => expect(result.current.status).toBe("available"));
  });

  it("ignores stale responses from out-of-order requests", async () => {
    // Simulate a slow request for "alice" and a fast request for "alicia".
    let aliceResolve: (value: Response) => void;
    let aliciaResolve: (value: Response) => void;

    fetchSpy
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            aliceResolve = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            aliciaResolve = resolve;
          }),
      );

    const { result } = renderHook(() => useUsernameAvailability());

    act(() => {
      result.current.check("alice");
    });

    act(() => {
      vi.advanceTimersByTime(300);
    });

    act(() => {
      result.current.check("alicia");
    });

    act(() => {
      vi.advanceTimersByTime(300);
    });

    // Resolve the newer request first.
    await act(async () => {
      aliciaResolve!(new Response(JSON.stringify({ available: true }), { status: 200 }));
    });

    await waitFor(() => expect(result.current.status).toBe("available"));

    // Resolve the older request afterwards.
    await act(async () => {
      aliceResolve!(new Response(JSON.stringify({ available: false }), { status: 200 }));
    });

    // Status should remain available, not flip to taken.
    expect(result.current.status).toBe("available");
  });

  it("aborts in-flight requests when reset", async () => {
    fetchSpy.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          const controller = new AbortController();
          const id = setTimeout(() => reject(new DOMException("Aborted", "AbortError")), 50);
          controller.signal.addEventListener("abort", () => {
            clearTimeout(id);
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    );

    const { result } = renderHook(() => useUsernameAvailability());

    act(() => {
      result.current.check("johndoe");
    });

    act(() => {
      vi.advanceTimersByTime(300);
    });

    act(() => {
      result.current.reset();
    });

    await waitFor(() => expect(result.current.status).toBe("idle"));
  });

  it("sets unknown status and error on network failure", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("Network error"));

    const { result } = renderHook(() => useUsernameAvailability());

    act(() => {
      result.current.check("johndoe");
    });

    act(() => {
      vi.advanceTimersByTime(300);
    });

    await waitFor(() => expect(result.current.status).toBe("unknown"));
    expect(result.current.error).toBe(
      "Couldn’t verify username. Check your connection and try again.",
    );
  });

  it("does not call the API for invalid usernames", async () => {
    const { result } = renderHook(() => useUsernameAvailability());

    act(() => {
      result.current.check("a");
    });

    act(() => {
      vi.advanceTimersByTime(300);
    });

    await waitFor(() => expect(result.current.status).toBe("unknown"));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.current.error).toBe("Username must be at least 2 characters.");
  });

  it("returns the availability result from check", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ available: true }), { status: 200 }),
    );

    const { result } = renderHook(() => useUsernameAvailability());

    let checkResult: Awaited<ReturnType<typeof result.current.check>> | null = null;
    await act(async () => {
      checkResult = await result.current.check("johndoe");
    });

    await waitFor(() => expect(result.current.status).toBe("available"));
    expect(checkResult).toEqual({ status: "available", available: true });
  });
});
