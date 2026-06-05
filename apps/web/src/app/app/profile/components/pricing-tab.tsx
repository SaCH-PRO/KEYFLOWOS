"use client";

import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import { Calculator, DollarSign, Clock, TrendingUp, Target, Sparkles } from "lucide-react";

interface PricingInputs {
  monthlyIncomeGoal: number;
  monthlyExpenses: number;
  billableHoursPerWeek: number;
  nonBillableHoursPerWeek: number;
  vacationWeeksPerYear: number;
  taxRate: number;
  desiredProfitMargin: number;
  projectBuffer: number;
}

const DEFAULTS: PricingInputs = {
  monthlyIncomeGoal: 15000,
  monthlyExpenses: 4000,
  billableHoursPerWeek: 25,
  nonBillableHoursPerWeek: 15,
  vacationWeeksPerYear: 4,
  taxRate: 25,
  desiredProfitMargin: 30,
  projectBuffer: 15,
};

function fmtMoney(n: number) {
  return `TTD ${n.toLocaleString("en-TT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function Field({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  prefix = "",
  suffix = "",
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  prefix?: string;
  suffix?: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-muted-foreground">{label}</label>
        <span className="text-xs font-mono text-foreground">
          {prefix}{value.toLocaleString()}{suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1.5 rounded-full appearance-none bg-white/[0.06] accent-[hsl(var(--kf-accent1))]"
      />
    </div>
  );
}

export function PricingTab() {
  const [inputs, setInputs] = useState<PricingInputs>(DEFAULTS);

  const results = useMemo(() => {
    const weeksPerYear = 52 - inputs.vacationWeeksPerYear;
    const totalWeeklyHours = inputs.billableHoursPerWeek + inputs.nonBillableHoursPerWeek;
    const totalAnnualHours = totalWeeklyHours * weeksPerYear;
    const billableAnnualHours = inputs.billableHoursPerWeek * weeksPerYear;

    const annualExpenses = inputs.monthlyExpenses * 12;
    const annualIncomeGoal = inputs.monthlyIncomeGoal * 12;
    const totalAnnualNeed = annualExpenses + annualIncomeGoal;
    const preTaxRevenueNeeded = totalAnnualNeed / (1 - inputs.taxRate / 100);
    const withProfitMargin = preTaxRevenueNeeded / (1 - inputs.desiredProfitMargin / 100);

    const hourlyRate = withProfitMargin / billableAnnualHours;
    const dailyRate = hourlyRate * 8;
    const projectRate = dailyRate * (1 + inputs.projectBuffer / 100);

    const utilizationRate = (inputs.billableHoursPerWeek / totalWeeklyHours) * 100;

    return {
      hourlyRate,
      dailyRate,
      projectRate,
      billableAnnualHours,
      totalAnnualHours,
      utilizationRate,
      annualTarget: withProfitMargin,
      monthlyTarget: withProfitMargin / 12,
    };
  }, [inputs]);

  const update = <K extends keyof PricingInputs>(key: K, value: PricingInputs[K]) => {
    setInputs((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[hsl(var(--kf-accent1))] to-[hsl(var(--kf-accent2))] flex items-center justify-center text-white">
          <Calculator className="w-5 h-5" />
        </div>
        <div>
          <h3 className="text-lg font-semibold">Value-Based Pricing Calculator</h3>
          <p className="text-sm text-muted-foreground">
            Know what to charge. Stop guessing, start earning what you deserve.
          </p>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Inputs */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-5 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5"
        >
          <h4 className="text-sm font-semibold flex items-center gap-2">
            <Target className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
            Your Numbers
          </h4>

          <Field label="Monthly personal income goal" value={inputs.monthlyIncomeGoal} onChange={(v) => update("monthlyIncomeGoal", v)} min={2000} max={100000} step={500} prefix="TTD " />
          <Field label="Monthly business expenses" value={inputs.monthlyExpenses} onChange={(v) => update("monthlyExpenses", v)} min={0} max={50000} step={500} prefix="TTD " />
          <Field label="Billable hours per week" value={inputs.billableHoursPerWeek} onChange={(v) => update("billableHoursPerWeek", v)} min={1} max={80} suffix=" hrs" />
          <Field label="Non-billable hours per week" value={inputs.nonBillableHoursPerWeek} onChange={(v) => update("nonBillableHoursPerWeek", v)} min={0} max={80} suffix=" hrs" />
          <Field label="Vacation weeks per year" value={inputs.vacationWeeksPerYear} onChange={(v) => update("vacationWeeksPerYear", v)} min={0} max={12} suffix=" wks" />
          <Field label="Effective tax rate" value={inputs.taxRate} onChange={(v) => update("taxRate", v)} min={0} max={50} suffix="%" />
          <Field label="Desired profit margin" value={inputs.desiredProfitMargin} onChange={(v) => update("desiredProfitMargin", v)} min={0} max={100} suffix="%" />
          <Field label="Project buffer / contingency" value={inputs.projectBuffer} onChange={(v) => update("projectBuffer", v)} min={0} max={50} suffix="%" />
        </motion.div>

        {/* Results */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="space-y-4"
        >
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
            <h4 className="text-sm font-semibold flex items-center gap-2 mb-4">
              <Sparkles className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
              Recommended Rates
            </h4>
            <div className="space-y-3">
              <RateCard label="Hourly Rate" value={fmtMoney(results.hourlyRate)} icon={Clock} subtitle={`${results.billableAnnualHours.toLocaleString()} billable hrs/year`} highlight />
              <RateCard label="Day Rate (8 hrs)" value={fmtMoney(results.dailyRate)} icon={DollarSign} />
              <RateCard label="Project Day Rate (with buffer)" value={fmtMoney(results.projectRate)} icon={TrendingUp} subtitle={`${inputs.projectBuffer}% buffer included`} />
            </div>
          </div>

          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
            <h4 className="text-sm font-semibold mb-3">Annual Outlook</h4>
            <div className="grid grid-cols-2 gap-3">
              <StatBox label="Annual Target" value={fmtMoney(results.annualTarget)} />
              <StatBox label="Monthly Target" value={fmtMoney(results.monthlyTarget)} />
              <StatBox label="Utilization Rate" value={`${results.utilizationRate.toFixed(1)}%`} />
              <StatBox label="Working Weeks" value={`${52 - inputs.vacationWeeksPerYear}`} />
            </div>
          </div>

          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
            <p className="text-sm text-emerald-300 leading-relaxed">
              <strong>Why this matters:</strong> Most Caribbean service providers undercharge by 30-50%. 
              This calculator factors in your real costs, taxes, and profit goals — not just &quot;what others charge.&quot;
            </p>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

function RateCard({
  label,
  value,
  icon: Icon,
  subtitle,
  highlight,
}: {
  label: string;
  value: string;
  icon: React.ElementType;
  subtitle?: string;
  highlight?: boolean;
}) {
  return (
    <div className={`flex items-center gap-4 p-4 rounded-xl border ${highlight ? "border-[hsl(var(--kf-accent1))/0.3] bg-[hsl(var(--kf-accent1))/0.06]" : "border-white/[0.06] bg-white/[0.02]"}`}>
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${highlight ? "bg-[hsl(var(--kf-accent1))/0.15]" : "bg-white/[0.04]"}`}>
        <Icon className={`w-5 h-5 ${highlight ? "text-[hsl(var(--kf-accent1))]" : "text-muted-foreground"}`} />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`text-lg font-bold ${highlight ? "text-[hsl(var(--kf-accent1))]" : "text-foreground"}`}>{value}</p>
        {subtitle && <p className="text-[10px] text-muted-foreground">{subtitle}</p>}
      </div>
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-3 rounded-xl border border-white/[0.06] bg-white/[0.02]">
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</p>
      <p className="text-sm font-semibold mt-0.5">{value}</p>
    </div>
  );
}
