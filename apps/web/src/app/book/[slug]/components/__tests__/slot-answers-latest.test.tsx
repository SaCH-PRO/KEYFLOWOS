/**
 * SWP-BOOKING-SLOTS repair round 2: only the latest ask of a slots request lands (checkout-flow useSlotAnswers).
 *
 * A request is asked again while an older ask may still be in flight: forget() (a refused Place Order) asks every
 * row afresh. If the older answer arrives after the newer one, it must not replace it: it may predate the booking
 * that made Place Order refuse.
 *
 *   SAL-01  an older answer arriving after a newer one for the same request is dropped; the newer one stays
 */
import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const pending: Array<(v: unknown) => void> = [];
vi.mock("@/lib/api", () => ({
  apiGet: () => new Promise((resolve) => pending.push(resolve)),
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
}));

import * as flow from "../checkout-flow";

type Hook = (businessId: string, timeZone: string | null | undefined, requests: Array<{ serviceId: string; date: string; staffId: string }>) => {
  answerFor: (r: { serviceId: string; date: string; staffId: string }) => Array<{ time: string; startIso: string }> | null | undefined;
  forget: () => void;
};
const useSlotAnswers = (flow as unknown as { useSlotAnswers: Hook }).useSlotAnswers;

const REQUEST = { serviceId: "svc_sal", date: "2026-12-15", staffId: "" };
const OLDER = { data: { date: "2026-12-15", slots: ["2026-12-15T15:00:00.000Z"] }, error: null }; // 11:00, since taken
const NEWER = { data: { date: "2026-12-15", slots: ["2026-12-15T16:00:00.000Z"] }, error: null }; // 12:00

describe("SWP-BOOKING-SLOTS: useSlotAnswers keeps only the latest ask's answer", () => {
  it("SAL-01 an older answer arriving after a newer one is dropped", async () => {
    expect(typeof useSlotAnswers).toBe("function");
    const requests = [REQUEST];
    const { result } = renderHook(() => useSlotAnswers("biz_sal", "America/Port_of_Spain", requests));
    await waitFor(() => expect(pending).toHaveLength(1));

    act(() => result.current.forget());
    await waitFor(() => expect(pending).toHaveLength(2));

    await act(async () => pending[1](NEWER));
    await waitFor(() => expect(result.current.answerFor(REQUEST)).toEqual([{ time: "12:00", startIso: "2026-12-15T16:00:00.000Z" }]));
    await act(async () => pending[0](OLDER));
    expect(result.current.answerFor(REQUEST), "the older answer does not replace the newer").toEqual([
      { time: "12:00", startIso: "2026-12-15T16:00:00.000Z" },
    ]);
  });
});
