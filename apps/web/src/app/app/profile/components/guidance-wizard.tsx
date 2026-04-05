"use client";

import { useState, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, ChevronRight, Save, Check, X } from "lucide-react";
import { Button } from "@keyflow/ui";
import { GuidanceProfile, WIZARD_STEPS } from "./guidance-types";
import {
  saveGuidanceDraft,
  loadGuidanceDraft,
  saveGuidanceStep,
  loadGuidanceStep,
  setGuidanceStatus,
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

interface BusinessGuidanceWizardProps {
  onClose: () => void;
  onComplete: () => void;
}

export default function BusinessGuidanceWizard({ onClose, onComplete }: BusinessGuidanceWizardProps) {
  const [profile, setProfile] = useState<GuidanceProfile>(loadGuidanceDraft);
  const [currentStep, setCurrentStep] = useState(() => loadGuidanceStep());
  const [direction, setDirection] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [showSaved, setShowSaved] = useState(false);

  const completionPercentage = getGuidanceCompletionPercentage(profile);
  const completionMap = getStepCompletionMap(profile);

  useEffect(() => {
    saveGuidanceStep(currentStep);
  }, [currentStep]);

  const handleChange = useCallback((updates: Partial<GuidanceProfile>) => {
    setProfile((prev) => {
      const next = { ...prev, ...updates };
      saveGuidanceDraft(next);
      return next;
    });
  }, []);

  const handleSaveDraft = useCallback(() => {
    saveGuidanceDraft(profile);
    setShowSaved(true);
    setTimeout(() => setShowSaved(false), 2000);
  }, [profile]);

  const goNext = useCallback(() => {
    if (currentStep < WIZARD_STEPS.length - 1) {
      setDirection(1);
      setCurrentStep((s) => s + 1);
    }
  }, [currentStep]);

  const goBack = useCallback(() => {
    if (currentStep > 0) {
      setDirection(-1);
      setCurrentStep((s) => s - 1);
    }
  }, [currentStep]);

  const goToStep = useCallback((step: number) => {
    setDirection(step > currentStep ? 1 : -1);
    setCurrentStep(step);
  }, [currentStep]);

  const handleSubmit = useCallback(async () => {
    setSubmitting(true);
    saveGuidanceDraft(profile);
    await new Promise((r) => setTimeout(r, 2000));
    setGuidanceStatus("complete");
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
