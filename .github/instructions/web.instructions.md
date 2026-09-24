---
applyTo: "apps/web/**/*.{ts,tsx,css}"
---

For frontend changes:
- trace the complete user journey, not only the component diff;
- check loading, empty, error, retry, and permission-denied states;
- verify responsive/mobile behavior and keyboard/accessibility regressions;
- inspect server/client component boundaries and unnecessary `"use client"` expansion;
- flag API contract drift, stale assumptions about backend response shapes, and missing error handling;
- check that optimistic UI cannot leave the interface inconsistent after a failed mutation;
- preserve reduced-motion behavior and existing navigation/gesture conventions documented in `AGENTS.md`;
- focus review comments on user-visible correctness and regressions rather than subjective styling preferences.
