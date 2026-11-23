/**
 * FU-GENOME-SURFACES-REVENUE (owner ruling D-233). The server serves the genome composites (genome integrity, executive
 * readiness, stage; the KEY genome's overall, integrity, readiness and confidence) as null to a member without revenue
 * read, and names them in `withheldForRevenue`. A surface renders such a value as withheld: no number, no grade, no ring
 * segment, no stage position.
 */
export const WITHHELD_LABEL = "Withheld";

/** A composite the reader is served: a number. null or undefined is withheld. */
export function isServedScore(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** "57%" for a served score, "Withheld" for a withheld one. */
export function pctOrWithheld(value: number | null | undefined): string {
  return isServedScore(value) ? `${Math.round(value)}%` : WITHHELD_LABEL;
}

/** "REVENUE ENGINE" for a served stage, "Withheld" for a withheld one. */
export function stageOrWithheld(stage: string | null | undefined): string {
  return typeof stage === "string" && stage.length > 0 ? stage.replace(/_/g, " ") : WITHHELD_LABEL;
}
