"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, ChevronRight, Save, Check, X } from "lucide-react";
import { Button } from "@keyflow/ui";
import { GuidanceProfile, WIZARD_STEPS } from "./guidance-types";
import {
  saveGuidanceDraft,
  loadGuidanceDraft,
  saveGuidanceStep,
  loadGuidanceStep,
  getGuidanceCompletionPercentage,
  getStepCompletionMap,
} from "./guidance-storage";
import {
  WelcomeStep,
  FounderContextStep,
  BusinessIdentityStep,
  OfferDefinitionStep,
  CustomerDefinitionStep,
  RevenueModelStep,
  CostFinanceStep,
  OperationsStep,
  LegalComplianceStep,
  GrowthAcquisitionStep,
  ConstraintsGoalsStep,
  ReviewStep,
  GenerateStep,
} from "./wizard-steps";
import { apiPostSimple, apiPut } from "@/lib/api";
import { getStoredBusinessId } from "@/lib/workspace";

interface BusinessGuidanceWizardProps {
  onClose: () => void;
  onComplete: () => void;
}

function buildStepPayload(stepKey: string, profile: GuidanceProfile): Record<string, unknown> {
  switch (stepKey) {
    case "founder":
      return {
        weeklyHoursAvailable: profile.weeklyHours ?? undefined,
        notes: [
          profile.founderName ? `Founder: ${profile.founderName}` : null,
          profile.founderRole ? `Role: ${profile.founderRole}` : null,
          profile.founderLocation ? `Location: ${profile.founderLocation}` : null,
          profile.experienceLevel ? `Experience: ${profile.experienceLevel}` : null,
          profile.employmentStatus ? `Status: ${profile.employmentStatus}` : null,
          profile.cashCapacity ? `Cash capacity: ${profile.cashCapacity}` : null,
          profile.willingnessToHire ? `Hiring: ${profile.willingnessToHire}` : null,
          profile.primaryGoal ? `Goal: ${profile.primaryGoal}` : null,
        ].filter(Boolean).join(" | ") || undefined,
      };
    case "identity":
      return {
        missionStatement: profile.businessName || undefined,
        uniqueSellingPoint: profile.differentiator || profile.industry || undefined,
        targetMarket: profile.businessType || undefined,
        coreValues: profile.differentiator ? [profile.differentiator] : undefined,
        notes: [
          profile.businessName ? `Business: ${profile.businessName}` : null,
          profile.industry ? `Industry: ${profile.industry}` : null,
          profile.businessStage ? `Stage: ${profile.businessStage}` : null,
          profile.businessType ? `Type: ${profile.businessType}` : null,
          profile.legalStatus ? `Legal: ${profile.legalStatus}` : null,
          profile.website ? `Website: ${profile.website}` : null,
        ].filter(Boolean).join(" | ") || undefined,
      };
    case "offer":
      return {
        primaryOffer: profile.offerDescription || undefined,
        offerType: profile.businessType || undefined,
        valueProposition: profile.whyCustomersBuy || undefined,
        differentiators: profile.differentiator ? [profile.differentiator] : undefined,
        pricingModel: profile.pricingModel || undefined,
        priceRangeLow: profile.averageOrderValue ?? undefined,
        deliveryMethod: profile.deliveryMethod || undefined,
        notes: [
          profile.offerName ? `Offer: ${profile.offerName}` : null,
          profile.problemSolved ? `Problem solved: ${profile.problemSolved}` : null,
          profile.packageStructure ? `Packages: ${profile.packageStructure}` : null,
        ].filter(Boolean).join(" | ") || undefined,
      };
    case "customer": {
      const acquisitionChannels = profile.marketingChannels.length > 0
        ? profile.marketingChannels
        : profile.leadSource
          ? [profile.leadSource]
          : undefined;
      return {
        targetDemographic: profile.idealCustomer || undefined,
        currentCustomerCount: profile.currentCustomerCount ?? undefined,
        acquisitionChannels,
        customerLifetimeValue: profile.lifetimeValue ?? undefined,
        notes: [
          profile.b2bOrB2c ? `Model: ${profile.b2bOrB2c}` : null,
          profile.painPoints ? `Pain points: ${profile.painPoints}` : null,
          profile.budgetLevel ? `Budget: ${profile.budgetLevel}` : null,
          profile.customerGeography ? `Geography: ${profile.customerGeography}` : null,
          profile.customerSegment ? `Segment: ${profile.customerSegment}` : null,
        ].filter(Boolean).join(" | ") || undefined,
      };
    }
    case "revenue": {
      const annualRevenue = profile.monthlySalesVolume != null
        ? profile.monthlySalesVolume * 12
        : undefined;
      const recurringPercent = profile.revenueModelType === "subscription"
        ? 100
        : profile.revenueModelType === "retainer"
          ? 80
          : profile.revenueModelType === "mixed"
            ? 50
            : undefined;
      return {
        monthlyRevenue: profile.monthlySalesVolume ?? undefined,
        annualRevenue,
        averageOrderValue: profile.averageOrderValue ?? undefined,
        revenueStreams: profile.revenueModelType ? [profile.revenueModelType] : undefined,
        targetMonthlyRevenue: profile.revenueTarget ?? undefined,
        recurringPercent,
        notes: [
          profile.revenueModelType ? `Model: ${profile.revenueModelType}` : null,
          profile.pricingModel ? `Pricing: ${profile.pricingModel}` : null,
          profile.priceRange ? `Price range: ${profile.priceRange}` : null,
          profile.seasonality ? `Seasonality: ${profile.seasonality}` : null,
        ].filter(Boolean).join(" | ") || undefined,
      };
    }
    case "finance": {
      const monthlyBurnRate = (profile.fixedCosts != null && profile.variableCosts != null)
        ? profile.fixedCosts + profile.variableCosts
        : profile.fixedCosts ?? profile.variableCosts ?? undefined;
      const profitMarginRaw = (profile.monthlySalesVolume != null && profile.monthlySalesVolume > 0 && profile.fixedCosts != null && profile.variableCosts != null)
        ? Math.round(((profile.monthlySalesVolume - profile.fixedCosts - profile.variableCosts) / profile.monthlySalesVolume) * 100)
        : undefined;
      const profitMarginPercent = profitMarginRaw !== undefined ? Math.max(0, Math.min(100, profitMarginRaw)) : undefined;
      return {
        currentCashReserve: profile.cashOnHand ?? undefined,
        monthlyFixedCosts: profile.fixedCosts ?? undefined,
        monthlyVariableCosts: profile.variableCosts ?? undefined,
        monthlyBurnRate,
        profitMarginPercent,
        startupCapital: profile.startupBudget ?? undefined,
        fundingSources: profile.fundingSource ? [profile.fundingSource] : undefined,
        notes: profile.itemizedMonthlyCosts || undefined,
      };
    }
    case "operations": {
      const teamSizeNum = profile.teamSize ?? undefined;
      return {
        teamSize: teamSizeNum,
        fullTimeEmployees: teamSizeNum,
        toolsUsed: profile.tools.length > 0 ? profile.tools : undefined,
        bottlenecks: profile.bottlenecks ? [profile.bottlenecks] : undefined,
        keyProcesses: profile.deliverySteps.length > 0 ? profile.deliverySteps : undefined,
        notes: [
          profile.fulfillmentModel ? `Fulfillment: ${profile.fulfillmentModel}` : null,
          profile.suppliers ? `Suppliers: ${profile.suppliers}` : null,
          profile.onboardingProcess ? `Onboarding: ${profile.onboardingProcess}` : null,
          profile.supportProcess ? `Support: ${profile.supportProcess}` : null,
          profile.retentionProcess ? `Retention: ${profile.retentionProcess}` : null,
        ].filter(Boolean).join(" | ") || undefined,
      };
    }
    case "compliance":
      return {
        businessRegistered: profile.registrationStatus === "registered" || profile.registrationStatus === "yes",
        registrationType: profile.legalStructure || undefined,
        taxIdNumber: profile.taxId || undefined,
        hasBusinessInsurance: profile.insuranceStatus === "yes" || profile.insuranceStatus === "active",
        dataProtectionCompliant: profile.privacyPolicy === "yes" || profile.privacyPolicy === "active",
        notes: [
          profile.registrationStatus ? `Registration: ${profile.registrationStatus}` : null,
          profile.bankAccount ? `Bank account: ${profile.bankAccount}` : null,
          profile.contractsInPlace ? `Contracts: ${profile.contractsInPlace}` : null,
          profile.bookkeepingMethod ? `Bookkeeping: ${profile.bookkeepingMethod}` : null,
        ].filter(Boolean).join(" | ") || undefined,
      };
    case "growth":
      return {
        marketingChannels: profile.marketingChannels.length > 0 ? profile.marketingChannels : undefined,
        referralProgram: profile.hasReferralProgram,
        notes: [
          profile.leadSource ? `Lead source: ${profile.leadSource}` : null,
          profile.retentionStrategy ? `Retention: ${profile.retentionStrategy}` : null,
          profile.emailListSize != null ? `Email list: ${profile.emailListSize}` : null,
          profile.monthlyLeads != null ? `Monthly leads: ${profile.monthlyLeads}` : null,
        ].filter(Boolean).join(" | ") || undefined,
      };
    case "goals":
      return {
        shortTermGoals: profile.shortTermGoals ? [profile.shortTermGoals] : undefined,
        longTermGoals: profile.mediumTermGoals ? [profile.mediumTermGoals] : undefined,
        biggestChallenges: profile.biggestChallenges ? [profile.biggestChallenges] : undefined,
        timelineUrgency: String(profile.urgencyLevel),
        revenueTarget12m: profile.revenueTarget ?? undefined,
        notes: profile.definitionOfSuccess || undefined,
      };
    default:
      return {};
  }
}

const STEP_KEYS = ["founder", "identity", "offer", "customer", "revenue", "finance", "operations", "compliance", "growth", "goals"] as const;

const WIZARD_STEP_TO_BACKEND_KEY: Record<number, typeof STEP_KEYS[number]> = {
  1: "founder", 2: "identity", 3: "offer", 4: "customer", 5: "revenue",
  6: "finance", 7: "operations", 8: "compliance", 9: "growth", 10: "goals",
};

export default function BusinessGuidanceWizard({ onClose, onComplete }: BusinessGuidanceWizardProps) {
  const [profile, setProfile] = useState<GuidanceProfile>(loadGuidanceDraft);
  const [currentStep, setCurrentStep] = useState(() => loadGuidanceStep());
  const [direction, setDirection] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [showSaved, setShowSaved] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const profileStarted = useRef(false);

  const completionPercentage = getGuidanceCompletionPercentage(profile);
  const completionMap = getStepCompletionMap(profile);

  useEffect(() => {
    const businessId = getStoredBusinessId();
    if (!businessId || profileStarted.current) return;
    profileStarted.current = true;
    apiPostSimple(`/business-guidance/${businessId}/start`, {}).then((res) => {
      if (res.error) {
        console.warn("[Guidance] Could not start profile session:", res.error);
        profileStarted.current = false;
      }
    });
  }, []);

  useEffect(() => {
    saveGuidanceStep(currentStep);
  }, [currentStep]);

  const handleChange = useCallback((updates: Partial<GuidanceProfile>) => {
    setProfile((prev) => {
      const next = { ...prev, ...updates };
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => {
        saveGuidanceDraft(next);
      }, 500);
      return next;
    });
  }, []);

  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, []);

  const handleSaveDraft = useCallback(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    saveGuidanceDraft(profile);
    setShowSaved(true);
    setTimeout(() => setShowSaved(false), 2000);
  }, [profile]);

  const persistCurrentStep = useCallback(async (stepIndex: number, currentProfile: GuidanceProfile) => {
    const businessId = getStoredBusinessId();
    if (!businessId) return;
    const stepKey = WIZARD_STEP_TO_BACKEND_KEY[stepIndex];
    if (!stepKey) return;
    const payload = buildStepPayload(stepKey, currentProfile);
    const res = await apiPut(`/business-guidance/${businessId}/step/${stepKey}`, payload);
    if (res.error) {
      console.warn(`[Guidance] Step "${stepKey}" auto-save failed: ${res.error}`);
    }
  }, []);

  const goNext = useCallback(() => {
    if (currentStep < WIZARD_STEPS.length - 1) {
      setDirection(1);
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      saveGuidanceDraft(profile);
      persistCurrentStep(currentStep, profile);
      setCurrentStep((s) => s + 1);
    }
  }, [currentStep, profile, persistCurrentStep]);

  const goBack = useCallback(() => {
    if (currentStep > 0) {
      setDirection(-1);
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      saveGuidanceDraft(profile);
      persistCurrentStep(currentStep, profile);
      setCurrentStep((s) => s - 1);
    }
  }, [currentStep, profile, persistCurrentStep]);

  const goToStep = useCallback((step: number) => {
    setDirection(step > currentStep ? 1 : -1);
    setCurrentStep(step);
  }, [currentStep]);

  const handleSubmit = useCallback(async () => {
    setSubmitting(true);
    setSubmitError(null);

    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    saveGuidanceDraft(profile);

    const businessId = getStoredBusinessId();
    if (!businessId) {
      setSubmitting(false);
      setSubmitError("No business found. Please set up your business profile first.");
      return;
    }

    const startRes = await apiPostSimple(`/business-guidance/${businessId}/start`, {});
    if (startRes.error) {
      setSubmitError(`Failed to start submission: ${startRes.error}`);
      setSubmitting(false);
      return;
    }

    for (const stepKey of STEP_KEYS) {
      const payload = buildStepPayload(stepKey, profile);
      const stepRes = await apiPut(`/business-guidance/${businessId}/step/${stepKey}`, payload);
      if (stepRes.error) {
        setSubmitError(`Failed to save step "${stepKey}": ${stepRes.error}`);
        setSubmitting(false);
        return;
      }
    }

    const submitRes = await apiPostSimple(`/business-guidance/${businessId}/submit`, {});
    if (submitRes.error) {
      setSubmitError(`Failed to submit: ${submitRes.error}`);
      setSubmitting(false);
      return;
    }

    setSubmitting(false);
    setDirection(1);
    setCurrentStep(12);
    onComplete();
  }, [profile, onComplete]);

  const stepVariants = {
    enter: (dir: number) => ({
      x: dir > 0 ? 60 : -60,
      opacity: 0,
    }),
    center: {
      x: 0,
      opacity: 1,
      transition: { duration: 0.3, ease: "easeOut" },
    },
    exit: (dir: number) => ({
      x: dir > 0 ? -60 : 60,
      opacity: 0,
      transition: { duration: 0.2 },
    }),
  } as const;

  const renderStep = () => {
    switch (currentStep) {
      case 0:
        return <WelcomeStep onStart={goNext} />;
      case 1:
        return <FounderContextStep profile={profile} onChange={handleChange} />;
      case 2:
        return <BusinessIdentityStep profile={profile} onChange={handleChange} />;
      case 3:
        return <OfferDefinitionStep profile={profile} onChange={handleChange} />;
      case 4:
        return <CustomerDefinitionStep profile={profile} onChange={handleChange} />;
      case 5:
        return <RevenueModelStep profile={profile} onChange={handleChange} />;
      case 6:
        return <CostFinanceStep profile={profile} onChange={handleChange} />;
      case 7:
        return <OperationsStep profile={profile} onChange={handleChange} />;
      case 8:
        return <LegalComplianceStep profile={profile} onChange={handleChange} />;
      case 9:
        return <GrowthAcquisitionStep profile={profile} onChange={handleChange} />;
      case 10:
        return <ConstraintsGoalsStep profile={profile} onChange={handleChange} />;
      case 11:
        return (
          <ReviewStep
            profile={profile}
            onNavigateToStep={goToStep}
            onSubmit={handleSubmit}
            submitting={submitting}
            submitError={submitError}
          />
        );
      case 12:
        return <GenerateStep />;
      default:
        return null;
    }
  };

  const isDataStep = currentStep >= 1 && currentStep <= 10;

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: "hsl(var(--background))" }}>
      <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-border/30">
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/20 transition-all min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            <X className="w-5 h-5" />
          </button>
          <div className="hidden sm:block">
            <h2 className="text-sm font-semibold">Business Guidance</h2>
            <p className="text-[11px] text-muted-foreground">
              Step {currentStep + 1} of {WIZARD_STEPS.length}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="text-right mr-2 hidden sm:block">
            <p className="text-xs font-medium">{completionPercentage}% complete</p>
          </div>
          <AnimatePresence>
            {showSaved && (
              <motion.span
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                className="text-xs text-emerald-400 flex items-center gap-1"
              >
                <Check className="w-3 h-3" /> Saved
              </motion.span>
            )}
          </AnimatePresence>
          {isDataStep && (
            <Button
              onClick={handleSaveDraft}
              className="flex items-center gap-1.5 min-h-[44px]"
            >
              <Save className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Save Draft</span>
            </Button>
          )}
        </div>
      </div>

      {currentStep > 0 && currentStep < 12 && (
        <div className="px-4 sm:px-6 py-3 border-b border-border/20 overflow-x-auto">
          <div className="flex items-center gap-1 min-w-max">
            {WIZARD_STEPS.slice(1, -1).map((step, i) => {
              const stepNum = i + 1;
              const isDone = completionMap[stepNum] || false;
              const isActive = currentStep === stepNum;
              const isPast = currentStep > stepNum;

              return (
                <div key={step.key} className="flex items-center">
                  {i > 0 && (
                    <div
                      className="w-4 sm:w-8 h-px mx-0.5"
                      style={{
                        background: isPast || isDone
                          ? "hsl(var(--kf-accent1))"
                          : "hsl(var(--border) / 0.4)",
                      }}
                    />
                  )}
                  <button
                    onClick={() => goToStep(stepNum)}
                    className="flex items-center gap-1 group min-h-[44px]"
                    title={step.label}
                  >
                    <div
                      className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold transition-all"
                      style={{
                        background: isDone
                          ? "hsl(var(--kf-accent1))"
                          : isActive
                            ? "hsl(var(--kf-accent1) / 0.15)"
                            : "hsl(var(--muted) / 0.3)",
                        color: isDone
                          ? "white"
                          : isActive
                            ? "hsl(var(--kf-accent1))"
                            : "hsl(var(--muted-foreground))",
                      }}
                    >
                      {isDone ? <Check className="w-3 h-3" /> : stepNum}
                    </div>
                    <span
                      className="text-[10px] font-medium hidden lg:inline whitespace-nowrap"
                      style={{
                        color: isActive
                          ? "hsl(var(--foreground))"
                          : "hsl(var(--muted-foreground))",
                      }}
                    >
                      {step.label}
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="w-full h-1 bg-muted/20">
        <motion.div
          className="h-full rounded-r-full"
          style={{ background: "hsl(var(--kf-accent1))" }}
          initial={false}
          animate={{ width: `${((currentStep) / (WIZARD_STEPS.length - 1)) * 100}%` }}
          transition={{ duration: 0.4, ease: "easeOut" }}
        />
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={currentStep}
              custom={direction}
              variants={stepVariants}
              initial="enter"
              animate="center"
              exit="exit"
            >
              {renderStep()}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {currentStep > 0 && currentStep < 12 && (
        <div className="px-4 sm:px-6 py-3 border-t border-border/30 flex items-center justify-between">
          <Button
            onClick={goBack}
            className="flex items-center gap-1.5 min-h-[44px]"
          >
            <ChevronLeft className="w-4 h-4" />
            Back
          </Button>

          {currentStep < 11 && (
            <Button
              onClick={goNext}
              className="flex items-center gap-1.5 min-h-[44px]"
            >
              Next
              <ChevronRight className="w-4 h-4" />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
