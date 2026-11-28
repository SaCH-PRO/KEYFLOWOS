/**
 * P231 TRUST-BADGES-TRUE-ONLY, repair round 8 (R8-3), under D-303: the Operations tab's saves (store status, delivery
 * methods, contact options) write the whole storefront config, FAQ entries included, so the tab shows the one
 * placeholder warning by them, whichever section is open. The tab's panels that read on their own are stubbed (they
 * are not under test; the warning is).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("@/lib/api", () => ({ apiGet: vi.fn(async () => ({ data: null, error: null })), apiPost: vi.fn(), apiPatch: vi.fn() }));
vi.mock("../components/orders-panel", () => ({ OrdersPanel: () => null }));
vi.mock("../components/fulfillment-panel", () => ({ FulfillmentPanel: () => null, canCompleteOffline: () => false }));
vi.mock("../components/shipping-zones-panel", () => ({ ShippingZonesPanel: () => null }));
vi.mock("../components/delivery-config-panel", () => ({ DeliveryConfigPanel: () => null }));
vi.mock("../components/qualification-config", () => ({ QualificationConfig: () => null }));
vi.mock("../components/hours-editor", () => ({ HoursEditor: () => null }));

import { OperationsMode } from "../components/operations-mode";

afterEach(() => cleanup());

const ops = (faqEntries: unknown[]) =>
  render(
    <OperationsMode
      businessId="biz_r8"
      storeEnabled
      businessHours={{}}
      storefrontConfig={{ faqEntries } as never}
      onConfigChange={vi.fn()}
      onSaveConfig={vi.fn(async () => undefined)}
      onConfigChangeAndSave={vi.fn(async () => undefined)}
      configSaving={false}
      onHoursChange={vi.fn()}
      onSaveHours={vi.fn(async () => undefined)}
      hoursSaving={false}
      onToggleStoreEnabled={vi.fn()}
    />,
  );

describe("R8-3: the Operations tab warns by its saves", () => {
  it("with FAQ entries holding a placeholder: one warning", () => {
    ops([{ id: "a", question: "Refunds?", answer: "[your refund policy]", order: 0 }]);
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    // r9: only the saves that write the config (the Hours save does not).
    expect(screen.getByRole("alert").textContent).toBe("1 FAQ entry still has a [bracketed] part: the store status, delivery and contact saves here save it as it is. Fill it in under Merchandising → FAQ & Policies.");
  });

  it("with none: no warning", () => {
    ops([{ id: "a", question: "Refunds?", answer: "Within 14 days.", order: 0 }]);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
