/**
 * WEDGE-WA-INBOUND-CAPTURE review round 2, the surviving mutant "clear on throw": if the read by id rejects outright
 * (lib/api's apiGet answers every failure today, so only a future change or a throwing handler gets here), the chosen
 * customer is kept and said, never cleared.
 *   CSR-16 the read rejects: the id stays, "couldn't load this customer's name" shows, nothing calls onChange("").
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { useState } from "react";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }) }));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  apiGet: vi.fn(async () => {
    throw new TypeError("Failed to fetch");
  }),
}));

import { ContactSelect } from "../contact-select";

const onChange = vi.fn();

function Harness() {
  const [value, setValue] = useState("c_thrown_1");
  return (
    <>
      <ContactSelect value={value} onChange={(id) => { setValue(id); onChange(id); }} contacts={[]} label="Client" />
      <output data-testid="chosen">{value}</output>
    </>
  );
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("the read by id rejecting outright", () => {
  it("CSR-16 keeps the chosen customer and says it could not be loaded", async () => {
    window.localStorage.setItem("kf_business_id", "biz_thrown");
    render(<Harness />);
    expect(await screen.findByText(/couldn.t load this customer/i)).toBeInTheDocument();
    expect(screen.getByTestId("chosen")).toHaveTextContent("c_thrown_1");
    expect(onChange).not.toHaveBeenCalled();
  });
});
