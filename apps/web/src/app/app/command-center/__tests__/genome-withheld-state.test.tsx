/**
 * FU-GENOME-SURFACES-REVENUE (owner ruling D-233). For a member without revenue read the server now serves the genome
 * composites (genome integrity, executive readiness, stage; the KEY genome's overall, integrity, readiness and
 * confidence) as null, named in withheldForRevenue. The genome hub and the command center render that as withheld:
 *
 *   GWS-01  the command-center health strips (v1, v2) do not throw on a null stage, and show "Withheld", never "null%",
 *           "NaN" or a 0% score, for each withheld composite
 *   GWS-02  the command-center genome cards and the KEY genome cards (v1, v2) do the same (no ring segment or grade)
 *   GWS-03  the genome orb shows the withheld state (no integrity number, no stage ladder position, no readiness)
 *   GWS-04  a revenue reader's numbers are rendered as before
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { CommandHealthStrip } from "../components/command-health-strip";
import { CommandHealthStripV2 } from "../components-v2/command-health-strip-v2";
import { CommandGenomeCard } from "../components/command-genome-card";
import { CommandKeyGenomeCard } from "../components/command-key-genome-card";
import { CommandKeyGenomeCardV2 } from "../components-v2/command-key-genome-card-v2";
import { GenomeOrb } from "@/components/genome/genome-orb";
import type { CommandCenterGenome, CommandCenterHealth, CommandCenterKeyGenome } from "@/lib/api/business-command-center";
import type { GenomeIntegrityResult } from "@/lib/api/business-genome";

afterEach(cleanup);

const counts = {
  criticalCount: 0, highPriorityCount: 0, pendingApprovalCount: 0, approvedAwaitingExecutionCount: 0, urgentTemporalCount: 0,
  pendingGenomeProposalCount: 0, assetRiskCount: 0, constitutionStale: false, blockedModuleCount: 0, lowReadinessModuleCount: 0,
  missingBlockingFactCount: 0,
};
const WITHHELD_HEALTH = {
  ...counts, genomeIntegrity: null, executiveReadinessScore: null, genomeStage: null,
  keyGenomeOverall: null, keyGenomeReadiness: null, keyGenomeConfidence: null,
  withheldForRevenue: ["genomeIntegrity", "executiveReadinessScore", "genomeStage"],
} satisfies CommandCenterHealth;
const WHOLE_HEALTH = {
  ...counts, genomeIntegrity: 57, executiveReadinessScore: 61, genomeStage: "REVENUE_ENGINE",
  keyGenomeOverall: 47, keyGenomeReadiness: 44, keyGenomeConfidence: 61,
} satisfies CommandCenterHealth;
const WITHHELD_KEY_GENOME = {
  overall: null, integrity: null, readiness: null, confidence: null, computedAt: new Date().toISOString(),
  sections: [], weakestSections: [], withheldForRevenue: ["overall", "integrity", "readiness", "confidence"],
} satisfies CommandCenterKeyGenome;
const WITHHELD_GENOME = { integrity: null, readiness: null, stage: null, pendingProposals: [], weakestSections: [], withheldForRevenue: ["genomeIntegrity"] } satisfies CommandCenterGenome;

function expectWithheld(text: string) {
  expect(text).toMatch(/Withheld/);
  expect(text).not.toMatch(/null|NaN|undefined/);
}

describe("FU-GENOME-SURFACES-REVENUE: the withheld genome state", () => {
  it("GWS-01 the health strips render withheld composites as withheld", () => {
    for (const Strip of [CommandHealthStrip, CommandHealthStripV2]) {
      const { container } = render(<Strip health={WITHHELD_HEALTH} />);
      expectWithheld(container.textContent ?? "");
      cleanup();
    }
  });

  it("GWS-02 the genome and KEY genome cards render withheld scores as withheld", () => {
    for (const node of [
      <CommandGenomeCard key="g" genome={WITHHELD_GENOME} />,
      <CommandKeyGenomeCard key="k" keyGenome={WITHHELD_KEY_GENOME} />,
      <CommandKeyGenomeCardV2 key="k2" keyGenome={WITHHELD_KEY_GENOME} />,
    ]) {
      const { container } = render(node);
      expectWithheld(container.textContent ?? "");
      cleanup();
    }
  });

  it("GWS-03 the genome orb renders the withheld state", () => {
    const genome = {
      genomeIntegrity: null, executiveReadinessScore: null, genomeStage: null, threePillarMinimumMet: true,
      genomeDnaScores: { founder: 100 }, genomeDnaConfidence: { founder: 100 }, readinessBreakdown: {},
      dnaSections: [{ key: "founder", label: "Founder DNA", integrity: 100, confidence: 100, summary: "", fieldsCaptured: 4, fieldsTotal: 4, missingFields: [], recommendation: "" }],
      withheldForRevenue: ["genomeIntegrity", "executiveReadinessScore", "genomeStage"],
    } satisfies GenomeIntegrityResult;
    const { container } = render(<GenomeOrb genome={genome} />);
    expectWithheld(container.textContent ?? "");
  });

  it("GWS-04 a revenue reader's numbers are rendered as before", () => {
    const { container } = render(<CommandHealthStrip health={WHOLE_HEALTH} />);
    const text = container.textContent ?? "";
    expect(text).toMatch(/57%/);
    expect(text).toMatch(/61%/);
    expect(text).toMatch(/REVENUE ENGINE/);
    expect(text).not.toMatch(/Withheld/);
  });
});
