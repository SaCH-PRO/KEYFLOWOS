import { GuidanceProfile, DEFAULT_GUIDANCE_PROFILE } from "./guidance-types";

const STORAGE_KEY = "kf_guidance_draft";
const STEP_KEY = "kf_guidance_step";

export function saveGuidanceDraft(profile: GuidanceProfile): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
}

export function loadGuidanceDraft(): GuidanceProfile {
  if (typeof window === "undefined") return { ...DEFAULT_GUIDANCE_PROFILE };
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return { ...DEFAULT_GUIDANCE_PROFILE };
  try {
    return { ...DEFAULT_GUIDANCE_PROFILE, ...JSON.parse(stored) };
  } catch {
    return { ...DEFAULT_GUIDANCE_PROFILE };
  }
}

export function saveGuidanceStep(step: number): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STEP_KEY, String(step));
}

export function loadGuidanceStep(): number {
  if (typeof window === "undefined") return 0;
  const stored = localStorage.getItem(STEP_KEY);
  const parsed = stored ? parseInt(stored, 10) : 0;
  if (isNaN(parsed) || parsed < 0 || parsed > 12) return 0;
  return parsed;
}

export function getGuidanceCompletionPercentage(profile: GuidanceProfile): number {
  const fields: (keyof GuidanceProfile)[] = [
    "founderName", "founderRole", "experienceLevel", "primaryGoal",
    "businessName", "industry", "businessStage", "businessType",
    "offerName", "offerDescription", "problemSolved", "deliveryMethod",
    "idealCustomer", "b2bOrB2c", "painPoints",
    "revenueModelType", "pricingModel",
    "fulfillmentModel",
    "registrationStatus",
    "leadSource",
    "biggestChallenges", "shortTermGoals", "definitionOfSuccess",
  ];

  let filled = 0;
  for (const key of fields) {
    const val = profile[key];
    if (typeof val === "string" && val.trim() !== "") filled++;
    else if (typeof val === "number" && val > 0) filled++;
    else if (typeof val === "boolean" && val) filled++;
    else if (Array.isArray(val) && val.length > 0) filled++;
  }

  return Math.round((filled / fields.length) * 100);
}

export function getStepCompletionMap(profile: GuidanceProfile): Record<number, boolean> {
  const check = (keys: (keyof GuidanceProfile)[]) =>
    keys.every((k) => {
      const v = profile[k];
      if (typeof v === "string") return v.trim() !== "";
      if (typeof v === "number") return v > 0;
      if (Array.isArray(v)) return v.length > 0;
      return false;
    });

  return {
    1: check(["founderName", "founderRole", "primaryGoal"]),
    2: check(["businessName", "industry", "businessType"]),
    3: check(["offerName", "offerDescription"]),
    4: check(["idealCustomer", "b2bOrB2c"]),
    5: check(["revenueModelType", "pricingModel"]),
    6: check(["fundingSource"]),
    7: check(["fulfillmentModel"]),
    8: check(["registrationStatus"]),
    9: check(["leadSource"]),
    10: check(["biggestChallenges", "shortTermGoals"]),
  };
}

export function clearGuidanceDraft(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(STEP_KEY);
}
