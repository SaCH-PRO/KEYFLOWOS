"use client";

import { Suspense, useState } from "react";
import { notFound, useSearchParams } from "next/navigation";
import {
  EventDrawer,
  type EventDrawerInitial,
} from "@/app/app/keyflow-command/components/event-drawer";

/**
 * Test-only fixture for `EventDrawer`, the component that powers
 * Google Calendar event create/edit from the unified calendar.
 *
 * Driving the real `/app/keyflow-command` page in Playwright would
 * require mocking the entire control-tower data graph (priorities,
 * graph snapshot, action queue, AI hub, …) just to surface a single
 * drawer. Mounting `EventDrawer` directly via this fixture keeps the
 * coverage focused on the all-day editing behavior the drawer is
 * actually responsible for: the date/datetime input toggle and the
 * inclusive-vs-exclusive end-date round-trip the backend expects.
 *
 * The fixture reads the initial drawer state from the `?initial=`
 * query param (URL-encoded JSON). Save calls go through the real
 * `apiPost`/`apiPatch` helpers, so the spec just intercepts the
 * outbound HTTP request to assert the payload.
 *
 * Only available outside production builds.
 */
function FixtureContents() {
  const search = useSearchParams();
  const initialParam = search.get("initial");
  const businessId = search.get("businessId") ?? "biz_e2e";
  let initial: EventDrawerInitial | null = null;
  if (initialParam) {
    try {
      initial = JSON.parse(initialParam) as EventDrawerInitial;
    } catch {
      initial = null;
    }
  }

  const [open, setOpen] = useState(true);
  const [savedCount, setSavedCount] = useState(0);
  const [closedCount, setClosedCount] = useState(0);

  return (
    <main style={{ padding: 24 }}>
      <h1 data-testid="fixture-title">__e2e: event-drawer fixture</h1>
      <button
        type="button"
        data-testid="reopen-drawer"
        onClick={() => setOpen(true)}
      >
        Reopen drawer
      </button>
      <pre data-testid="initial-json">
        {initial ? JSON.stringify(initial) : "(no initial)"}
      </pre>
      <pre data-testid="saved-count">{String(savedCount)}</pre>
      <pre data-testid="closed-count">{String(closedCount)}</pre>
      <EventDrawer
        open={open}
        businessId={businessId}
        initial={initial}
        onClose={() => {
          setOpen(false);
          setClosedCount((c) => c + 1);
        }}
        onSaved={() => setSavedCount((c) => c + 1)}
      />
    </main>
  );
}

export default function E2EEventDrawerFixturePage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }
  return (
    <Suspense fallback={<div>Loading fixture…</div>}>
      <FixtureContents />
    </Suspense>
  );
}
