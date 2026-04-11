"use client";

import {
  Rocket, User, Building2, Package, Users, DollarSign,
  Wallet, Settings, Shield, TrendingUp, Target, Clock,
  MapPin, Briefcase, Globe, CheckCircle2, AlertCircle,
  ChevronRight, Sparkles, ArrowRight,
} from "lucide-react";
import { Button } from "@keyflow/ui";
import { GuidanceProfile, EXPERIENCE_LEVELS, EMPLOYMENT_STATUSES, BUSINESS_TYPES,
  LEGAL_STATUSES, BUSINESS_STAGES_GUIDANCE, REVENUE_MODELS, PRICING_MODELS,
  FULFILLMENT_MODELS, MARKETING_CHANNEL_OPTIONS, FUNDING_SOURCES,
  INDUSTRY_OPTIONS_GUIDANCE } from "./guidance-types";
import { SelectField, TextField, TextAreaField, NumberField, SliderField,
  TagInput, MultiSelect, ToggleField } from "./guidance-fields";
import { getStepCompletionMap } from "./guidance-storage";

interface StepProps {
  profile: GuidanceProfile;
  onChange: (updates: Partial<GuidanceProfile>) => void;
}

export function WelcomeStep({ onStart }: { onStart: () => void }) {
  const benefits = [
    { icon: Sparkles, label: "Clarity", desc: "Understand your business model and positioning" },
    { icon: DollarSign, label: "Financial Visibility", desc: "Map costs, revenue, and growth targets" },
    { icon: Shield, label: "Risk Awareness", desc: "Identify legal, compliance, and operational gaps" },
    { icon: TrendingUp, label: "Growth Guidance", desc: "Get actionable strategies for customer acquisition" },
    { icon: Target, label: "Prioritized Actions", desc: "Know what to focus on first" },
    { icon: Building2, label: "Structure", desc: "Build a solid foundation for your business" },
  ];

  return (
    <div className="space-y-6 text-center max-w-lg mx-auto">
      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[hsl(var(--kf-accent1))] to-[hsl(var(--kf-accent2))] flex items-center justify-center mx-auto shadow-lg">
        <Rocket className="w-8 h-8 text-white" />
      </div>

      <div>
        <h2 className="text-xl font-bold">Business Guidance Assessment</h2>
        <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
          Answer a series of questions about your business and receive a personalized
          assessment with tailored recommendations, risk analysis, and growth strategies.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-left">
        {benefits.map(({ icon: Icon, label, desc }) => (
          <div
            key={label}
            className="flex items-start gap-3 p-3 rounded-xl bg-muted/10 border border-border/30"
          >
            <div className="w-8 h-8 rounded-lg bg-[hsl(var(--kf-accent1))]/10 flex items-center justify-center flex-shrink-0">
              <Icon className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
            </div>
            <div>
              <p className="text-xs font-semibold text-foreground">{label}</p>
              <p className="text-[11px] text-muted-foreground leading-relaxed">{desc}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 justify-center text-xs text-muted-foreground">
        <Clock className="w-3.5 h-3.5" />
        <span>Estimated time: ~15 minutes · You can save and resume at any point</span>
      </div>

      <Button onClick={onStart} className="w-full sm:w-auto px-8 min-h-[44px]">
        <span className="flex items-center gap-2">
          Start Assessment
          <ArrowRight className="w-4 h-4" />
        </span>
      </Button>
    </div>
  );
}

export function FounderContextStep({ profile, onChange }: StepProps) {
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <User className="h-4 w-4" style={{ color: "hsl(var(--kf-accent1))" }} />
        Founder Context
      </div>
      <p className="text-xs text-muted-foreground">Tell us about yourself and your role in the business.</p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <TextField
          label="Your Name"
          value={profile.founderName}
          onChange={(v) => onChange({ founderName: v })}
          placeholder="e.g., John Smith"
          icon={<User className="h-3 w-3" />}
        />
        <TextField
          label="Your Role"
          value={profile.founderRole}
          onChange={(v) => onChange({ founderRole: v })}
          placeholder="e.g., Founder & CEO"
          icon={<Briefcase className="h-3 w-3" />}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <TextField
          label="Location"
          value={profile.founderLocation}
          onChange={(v) => onChange({ founderLocation: v })}
          placeholder="e.g., Port of Spain, Trinidad"
          icon={<MapPin className="h-3 w-3" />}
        />
        <SelectField
          label="Experience Level"
          value={profile.experienceLevel}
          onChange={(v) => onChange({ experienceLevel: v })}
          options={EXPERIENCE_LEVELS}
          tooltip="How many years of business experience do you have?"
          icon={<Sparkles className="h-3 w-3" />}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <NumberField
          label="Weekly Hours Available"
          value={profile.weeklyHours}
          onChange={(v) => onChange({ weeklyHours: v })}
          placeholder="e.g., 40"
          tooltip="How many hours per week can you dedicate to your business?"
          icon={<Clock className="h-3 w-3" />}
          min={0}
          max={168}
        />
        <SelectField
          label="Employment Status"
          value={profile.employmentStatus}
          onChange={(v) => onChange({ employmentStatus: v })}
          options={EMPLOYMENT_STATUSES}
          icon={<Briefcase className="h-3 w-3" />}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SelectField
          label="Cash Capacity"
          value={profile.cashCapacity}
          onChange={(v) => onChange({ cashCapacity: v })}
          options={[
            { value: "none", label: "No capital available" },
            { value: "minimal", label: "Under $5,000 TTD" },
            { value: "moderate", label: "$5,000 - $25,000 TTD" },
            { value: "substantial", label: "$25,000 - $100,000 TTD" },
            { value: "significant", label: "Over $100,000 TTD" },
          ]}
          tooltip="How much cash can you invest in the business right now?"
          icon={<DollarSign className="h-3 w-3" />}
        />
        <SelectField
          label="Willingness to Hire"
          value={profile.willingnessToHire}
          onChange={(v) => onChange({ willingnessToHire: v })}
          options={[
            { value: "not-ready", label: "Not ready to hire" },
            { value: "open", label: "Open to it when needed" },
            { value: "actively-looking", label: "Actively looking to hire" },
            { value: "already-hiring", label: "Already have a team" },
          ]}
          icon={<Users className="h-3 w-3" />}
        />
      </div>

      <TextAreaField
        label="Primary Business Goal"
        value={profile.primaryGoal}
        onChange={(v) => onChange({ primaryGoal: v })}
        placeholder="What's the main thing you want to achieve with this business?"
        tooltip="Think about your #1 goal for the next 6-12 months"
        icon={<Target className="h-3 w-3" />}
        maxLength={500}
      />
    </div>
  );
}

export function BusinessIdentityStep({ profile, onChange }: StepProps) {
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Building2 className="h-4 w-4" style={{ color: "hsl(var(--kf-accent1))" }} />
        Business Identity
      </div>
      <p className="text-xs text-muted-foreground">Define your business fundamentals.</p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <TextField
          label="Business Name"
          value={profile.businessName}
          onChange={(v) => onChange({ businessName: v })}
          placeholder="Your business name"
          icon={<Building2 className="h-3 w-3" />}
        />
        <SelectField
          label="Industry"
          value={profile.industry}
          onChange={(v) => onChange({ industry: v })}
          options={INDUSTRY_OPTIONS_GUIDANCE.map((i) => ({ value: i, label: i }))}
          icon={<Briefcase className="h-3 w-3" />}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SelectField
          label="Business Stage"
          value={profile.businessStage}
          onChange={(v) => onChange({ businessStage: v })}
          options={BUSINESS_STAGES_GUIDANCE}
          tooltip="Where is your business in its lifecycle?"
          icon={<TrendingUp className="h-3 w-3" />}
        />
        <SelectField
          label="Business Type"
          value={profile.businessType}
          onChange={(v) => onChange({ businessType: v })}
          options={BUSINESS_TYPES}
          icon={<Package className="h-3 w-3" />}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SelectField
          label="Legal Status"
          value={profile.legalStatus}
          onChange={(v) => onChange({ legalStatus: v })}
          options={LEGAL_STATUSES}
          icon={<Shield className="h-3 w-3" />}
        />
        <NumberField
          label="Team Size"
          value={profile.teamSize}
          onChange={(v) => onChange({ teamSize: v })}
          placeholder="Including yourself"
          tooltip="Total number of people working in or on the business"
          icon={<Users className="h-3 w-3" />}
          min={1}
        />
      </div>

      <TextField
        label="Website"
        value={profile.website}
        onChange={(v) => onChange({ website: v })}
        placeholder="https://yourbusiness.com"
        icon={<Globe className="h-3 w-3" />}
      />

      <TagInput
        label="Social Media Links"
        tags={profile.socialLinks}
        onChange={(v) => onChange({ socialLinks: v })}
        placeholder="Add social media URL and press Enter"
        tooltip="Instagram, Facebook, LinkedIn, TikTok, etc."
        icon={<Globe className="h-3 w-3" />}
      />
    </div>
  );
}

export function OfferDefinitionStep({ profile, onChange }: StepProps) {
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Package className="h-4 w-4" style={{ color: "hsl(var(--kf-accent1))" }} />
        Offer Definition
      </div>
      <p className="text-xs text-muted-foreground">Describe your primary product or service.</p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <TextField
          label="Offer Name"
          value={profile.offerName}
          onChange={(v) => onChange({ offerName: v })}
          placeholder="e.g., Premium Web Design Package"
          icon={<Package className="h-3 w-3" />}
        />
        <SelectField
          label="Category"
          value={profile.offerCategory}
          onChange={(v) => onChange({ offerCategory: v })}
          options={[
            { value: "product", label: "Physical Product" },
            { value: "digital", label: "Digital Product" },
            { value: "service", label: "Service" },
            { value: "subscription", label: "Subscription" },
            { value: "course", label: "Course / Training" },
            { value: "consulting", label: "Consulting" },
          ]}
          icon={<Briefcase className="h-3 w-3" />}
        />
      </div>

      <TextAreaField
        label="Description"
        value={profile.offerDescription}
        onChange={(v) => onChange({ offerDescription: v })}
        placeholder="Describe what you offer in detail..."
        icon={<Sparkles className="h-3 w-3" />}
        maxLength={1000}
      />

      <TextAreaField
        label="Problem You Solve"
        value={profile.problemSolved}
        onChange={(v) => onChange({ problemSolved: v })}
        placeholder="What specific problem does your product/service solve?"
        tooltip="Be specific about the pain point your customers experience"
        icon={<Target className="h-3 w-3" />}
        maxLength={500}
      />

      <TextAreaField
        label="Why Customers Buy"
        value={profile.whyCustomersBuy}
        onChange={(v) => onChange({ whyCustomersBuy: v })}
        placeholder="What makes customers choose you over alternatives?"
        icon={<Users className="h-3 w-3" />}
        maxLength={500}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SelectField
          label="Delivery Method"
          value={profile.deliveryMethod}
          onChange={(v) => onChange({ deliveryMethod: v })}
          options={[
            { value: "in-person", label: "In-person" },
            { value: "online", label: "Online / Digital" },
            { value: "hybrid", label: "Hybrid (both)" },
            { value: "shipping", label: "Physical shipping" },
            { value: "download", label: "Digital download" },
          ]}
          icon={<Settings className="h-3 w-3" />}
        />
        <TextField
          label="Differentiator"
          value={profile.differentiator}
          onChange={(v) => onChange({ differentiator: v })}
          placeholder="What makes you unique?"
          tooltip="Your key competitive advantage"
          icon={<Sparkles className="h-3 w-3" />}
        />
      </div>

      <SliderField
        label="Offer Clarity Self-Rating"
        value={profile.clarityRating}
        onChange={(v) => onChange({ clarityRating: v })}
        labels={["Very unclear", "Unclear", "Neutral", "Clear", "Very clear"]}
        tooltip="How clearly defined is your offer right now?"
        icon={<CheckCircle2 className="h-3 w-3" />}
      />

      <TextAreaField
        label="Package Structure"
        value={profile.packageStructure}
        onChange={(v) => onChange({ packageStructure: v })}
        placeholder="Do you have tiers/packages? Describe your pricing structure..."
        tooltip="e.g., Basic / Pro / Enterprise tiers, or single pricing"
        icon={<Package className="h-3 w-3" />}
        maxLength={500}
      />
    </div>
  );
}

export function CustomerDefinitionStep({ profile, onChange }: StepProps) {
  const isLaunched = ["launched", "growing", "scaling", "established"].includes(profile.businessStage);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Users className="h-4 w-4" style={{ color: "hsl(var(--kf-accent1))" }} />
        Customer Definition
      </div>
      <p className="text-xs text-muted-foreground">Define who your customers are and how they buy.</p>

      <TextAreaField
        label="Ideal Customer"
        value={profile.idealCustomer}
        onChange={(v) => onChange({ idealCustomer: v })}
        placeholder="Describe your ideal customer in detail..."
        tooltip="Think about demographics, psychographics, behavior"
        icon={<Users className="h-3 w-3" />}
        maxLength={500}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <TextField
          label="Customer Segment"
          value={profile.customerSegment}
          onChange={(v) => onChange({ customerSegment: v })}
          placeholder="e.g., Small business owners"
          icon={<Target className="h-3 w-3" />}
        />
        <SelectField
          label="B2B or B2C"
          value={profile.b2bOrB2c}
          onChange={(v) => onChange({ b2bOrB2c: v })}
          options={[
            { value: "b2b", label: "B2B (Business to Business)" },
            { value: "b2c", label: "B2C (Business to Consumer)" },
            { value: "both", label: "Both B2B and B2C" },
          ]}
          icon={<Building2 className="h-3 w-3" />}
        />
      </div>

      <TextAreaField
        label="Customer Pain Points"
        value={profile.painPoints}
        onChange={(v) => onChange({ painPoints: v })}
        placeholder="What are the biggest frustrations your customers face?"
        icon={<AlertCircle className="h-3 w-3" />}
        maxLength={500}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SelectField
          label="Customer Budget Level"
          value={profile.budgetLevel}
          onChange={(v) => onChange({ budgetLevel: v })}
          options={[
            { value: "low", label: "Budget-conscious" },
            { value: "mid", label: "Mid-range" },
            { value: "high", label: "Premium / High-end" },
            { value: "enterprise", label: "Enterprise" },
          ]}
          icon={<DollarSign className="h-3 w-3" />}
        />
        <TextField
          label="Customer Geography"
          value={profile.customerGeography}
          onChange={(v) => onChange({ customerGeography: v })}
          placeholder="e.g., Trinidad & Tobago, Caribbean"
          icon={<MapPin className="h-3 w-3" />}
        />
      </div>

      <SliderField
        label="Customer Specificity Rating"
        value={profile.specificityRating}
        onChange={(v) => onChange({ specificityRating: v })}
        labels={["Very broad", "Broad", "Moderate", "Specific", "Very specific"]}
        tooltip="How narrowly have you defined your target customer?"
        icon={<Target className="h-3 w-3" />}
      />

      {isLaunched && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/20">
          <NumberField
            label="Current Customer Count"
            value={profile.currentCustomerCount}
            onChange={(v) => onChange({ currentCustomerCount: v })}
            placeholder="How many active customers?"
            icon={<Users className="h-3 w-3" />}
            min={0}
          />
          <NumberField
            label="Target Customer Count"
            value={profile.targetCustomerCount}
            onChange={(v) => onChange({ targetCustomerCount: v })}
            placeholder="Goal for next 12 months"
            icon={<Target className="h-3 w-3" />}
            min={0}
          />
        </div>
      )}
    </div>
  );
}

export function RevenueModelStep({ profile, onChange }: StepProps) {
  const isLaunched = ["launched", "growing", "scaling", "established"].includes(profile.businessStage);
  const isSaaS = profile.businessType === "saas";

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <DollarSign className="h-4 w-4" style={{ color: "hsl(var(--kf-accent1))" }} />
        Revenue Model
      </div>
      <p className="text-xs text-muted-foreground">How your business generates income.</p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SelectField
          label="Revenue Model Type"
          value={profile.revenueModelType}
          onChange={(v) => onChange({ revenueModelType: v })}
          options={REVENUE_MODELS}
          icon={<DollarSign className="h-3 w-3" />}
        />
        <SelectField
          label="Pricing Model"
          value={profile.pricingModel}
          onChange={(v) => onChange({ pricingModel: v })}
          options={PRICING_MODELS}
          icon={<DollarSign className="h-3 w-3" />}
        />
      </div>

      <TextField
        label="Price Range"
        value={profile.priceRange}
        onChange={(v) => onChange({ priceRange: v })}
        placeholder="e.g., $500 - $5,000 TTD per project"
        tooltip="What range do your prices fall in?"
        icon={<DollarSign className="h-3 w-3" />}
      />

      {isLaunched && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/20">
          <NumberField
            label="Average Order Value (TTD)"
            value={profile.averageOrderValue}
            onChange={(v) => onChange({ averageOrderValue: v })}
            placeholder="Average sale amount"
            prefix="TTD"
            icon={<DollarSign className="h-3 w-3" />}
            min={0}
          />
          <NumberField
            label="Customer Lifetime Value (TTD)"
            value={profile.lifetimeValue}
            onChange={(v) => onChange({ lifetimeValue: v })}
            placeholder="Total value per customer"
            prefix="TTD"
            icon={<DollarSign className="h-3 w-3" />}
            min={0}
          />
          <NumberField
            label="Monthly Sales Volume"
            value={profile.monthlySalesVolume}
            onChange={(v) => onChange({ monthlySalesVolume: v })}
            placeholder="Number of sales/month"
            icon={<TrendingUp className="h-3 w-3" />}
            min={0}
          />
        </div>
      )}

      {isSaaS && (
        <div className="p-3 rounded-xl bg-blue-500/5 border border-blue-500/20">
          <p className="text-xs text-blue-400 font-medium mb-1">SaaS-Specific</p>
          <p className="text-[11px] text-muted-foreground">
            Since you're building a SaaS product, track your subscription metrics closely — MRR, churn rate, and expansion revenue are critical.
          </p>
        </div>
      )}

      <ToggleField
        label="Do you offer upsells or cross-sells?"
        value={profile.upsellExists}
        onChange={(v) => onChange({ upsellExists: v })}
        icon={<TrendingUp className="h-3 w-3" />}
      />

      {profile.upsellExists && (
        <TextAreaField
          label="Upsell/Cross-sell Description"
          value={profile.upsellDescription}
          onChange={(v) => onChange({ upsellDescription: v })}
          placeholder="Describe your upsell or cross-sell offerings..."
          icon={<Package className="h-3 w-3" />}
          maxLength={500}
        />
      )}

      <SelectField
        label="Seasonality"
        value={profile.seasonality}
        onChange={(v) => onChange({ seasonality: v })}
        options={[
          { value: "none", label: "No seasonality — consistent year-round" },
          { value: "mild", label: "Mildly seasonal — some fluctuation" },
          { value: "moderate", label: "Moderately seasonal — clear peaks/dips" },
          { value: "highly", label: "Highly seasonal — major swings" },
        ]}
        tooltip="Does your revenue fluctuate throughout the year?"
        icon={<TrendingUp className="h-3 w-3" />}
      />
    </div>
  );
}

export function CostFinanceStep({ profile, onChange }: StepProps) {
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Wallet className="h-4 w-4" style={{ color: "hsl(var(--kf-accent1))" }} />
        Cost & Finance
      </div>
      <p className="text-xs text-muted-foreground">Map your financial landscape.</p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <NumberField
          label="Startup Budget (TTD)"
          value={profile.startupBudget}
          onChange={(v) => onChange({ startupBudget: v })}
          placeholder="Total startup investment"
          prefix="TTD"
          icon={<DollarSign className="h-3 w-3" />}
          min={0}
        />
        <NumberField
          label="Cash on Hand (TTD)"
          value={profile.cashOnHand}
          onChange={(v) => onChange({ cashOnHand: v })}
          placeholder="Current available cash"
          prefix="TTD"
          icon={<DollarSign className="h-3 w-3" />}
          min={0}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <NumberField
          label="Monthly Fixed Costs (TTD)"
          value={profile.fixedCosts}
          onChange={(v) => onChange({ fixedCosts: v })}
          placeholder="Rent, salaries, subscriptions..."
          prefix="TTD"
          tooltip="Costs that stay the same regardless of sales volume"
          icon={<DollarSign className="h-3 w-3" />}
          min={0}
        />
        <NumberField
          label="Monthly Variable Costs (TTD)"
          value={profile.variableCosts}
          onChange={(v) => onChange({ variableCosts: v })}
          placeholder="Materials, commissions..."
          prefix="TTD"
          tooltip="Costs that change with sales volume"
          icon={<DollarSign className="h-3 w-3" />}
          min={0}
        />
      </div>

      <TextAreaField
        label="Itemized Monthly Costs"
        value={profile.itemizedMonthlyCosts}
        onChange={(v) => onChange({ itemizedMonthlyCosts: v })}
        placeholder="List your main recurring expenses, e.g.:&#10;Rent: $3,000&#10;Internet: $500&#10;Software: $800"
        tooltip="Break down your biggest recurring expenses"
        icon={<DollarSign className="h-3 w-3" />}
        rows={4}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <NumberField
          label="Estimated Monthly Tax (TTD)"
          value={profile.taxEstimate}
          onChange={(v) => onChange({ taxEstimate: v })}
          placeholder="Estimated tax liability"
          prefix="TTD"
          icon={<DollarSign className="h-3 w-3" />}
          min={0}
        />
        <SelectField
          label="Funding Source"
          value={profile.fundingSource}
          onChange={(v) => onChange({ fundingSource: v })}
          options={FUNDING_SOURCES}
          icon={<Wallet className="h-3 w-3" />}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <NumberField
          label="Monthly Revenue Target (TTD)"
          value={profile.revenueTarget}
          onChange={(v) => onChange({ revenueTarget: v })}
          placeholder="Target monthly revenue"
          prefix="TTD"
          icon={<TrendingUp className="h-3 w-3" />}
          min={0}
        />
        <NumberField
          label="Monthly Profit Target (TTD)"
          value={profile.profitTarget}
          onChange={(v) => onChange({ profitTarget: v })}
          placeholder="Target monthly profit"
          prefix="TTD"
          icon={<TrendingUp className="h-3 w-3" />}
          min={0}
        />
      </div>
    </div>
  );
}

export function OperationsStep({ profile, onChange }: StepProps) {
  const hasTeam = (profile.teamSize ?? 0) > 1;
  const isClinic = profile.businessType === "clinic";

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Settings className="h-4 w-4" style={{ color: "hsl(var(--kf-accent1))" }} />
        Operations
      </div>
      <p className="text-xs text-muted-foreground">How your business runs day-to-day.</p>

      <SelectField
        label="Fulfillment Model"
        value={profile.fulfillmentModel}
        onChange={(v) => onChange({ fulfillmentModel: v })}
        options={FULFILLMENT_MODELS}
        tooltip="How do you deliver your product/service to customers?"
        icon={<Package className="h-3 w-3" />}
      />

      <TagInput
        label="Delivery / Production Steps"
        tags={profile.deliverySteps}
        onChange={(v) => onChange({ deliverySteps: v })}
        placeholder="Add a step and press Enter"
        tooltip="List the main steps to deliver your product or service"
        icon={<Settings className="h-3 w-3" />}
      />

      <TextAreaField
        label="Suppliers & Partners"
        value={profile.suppliers}
        onChange={(v) => onChange({ suppliers: v })}
        placeholder="Key suppliers, vendors, or partners you depend on..."
        icon={<Building2 className="h-3 w-3" />}
        maxLength={500}
      />

      <TagInput
        label="Tools & Software"
        tags={profile.tools}
        onChange={(v) => onChange({ tools: v })}
        placeholder="Add a tool and press Enter"
        tooltip="What tools and software does your business use?"
        icon={<Settings className="h-3 w-3" />}
      />

      {hasTeam && (
        <div className="p-4 rounded-xl bg-blue-500/5 border border-blue-500/20 space-y-4">
          <p className="text-xs text-blue-400 font-medium">Team Management</p>
          <TagInput
            label="Team Roles"
            tags={profile.teamRoles}
            onChange={(v) => onChange({ teamRoles: v })}
            placeholder="Add a role and press Enter"
            icon={<Users className="h-3 w-3" />}
          />
        </div>
      )}

      {isClinic && (
        <div className="p-3 rounded-xl bg-purple-500/5 border border-purple-500/20">
          <p className="text-xs text-purple-400 font-medium mb-1">Healthcare Workflow</p>
          <p className="text-[11px] text-muted-foreground">
            Document your patient intake, consultation, treatment, and follow-up workflows below.
          </p>
        </div>
      )}

      <TextAreaField
        label="Customer Onboarding Process"
        value={profile.onboardingProcess}
        onChange={(v) => onChange({ onboardingProcess: v })}
        placeholder="How do new customers get started?"
        icon={<Users className="h-3 w-3" />}
        maxLength={500}
      />

      <TextAreaField
        label="Support Process"
        value={profile.supportProcess}
        onChange={(v) => onChange({ supportProcess: v })}
        placeholder="How do you handle customer questions and issues?"
        icon={<Users className="h-3 w-3" />}
        maxLength={500}
      />

      <TextAreaField
        label="Retention Process"
        value={profile.retentionProcess}
        onChange={(v) => onChange({ retentionProcess: v })}
        placeholder="What do you do to keep customers coming back?"
        icon={<Users className="h-3 w-3" />}
        maxLength={500}
      />

      <TextAreaField
        label="Bottlenecks"
        value={profile.bottlenecks}
        onChange={(v) => onChange({ bottlenecks: v })}
        placeholder="What slows down your operations?"
        tooltip="Identify areas where work gets stuck or delayed"
        icon={<AlertCircle className="h-3 w-3" />}
        maxLength={500}
      />
    </div>
  );
}

export function LegalComplianceStep({ profile, onChange }: StepProps) {
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Shield className="h-4 w-4" style={{ color: "hsl(var(--kf-accent1))" }} />
        Legal & Compliance
      </div>
      <p className="text-xs text-muted-foreground">Ensure your business is properly protected.</p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SelectField
          label="Registration Status"
          value={profile.registrationStatus}
          onChange={(v) => onChange({ registrationStatus: v })}
          options={[
            { value: "registered", label: "Fully registered" },
            { value: "in-progress", label: "Registration in progress" },
            { value: "not-registered", label: "Not yet registered" },
          ]}
          icon={<Shield className="h-3 w-3" />}
        />
        <SelectField
          label="Legal Structure"
          value={profile.legalStructure}
          onChange={(v) => onChange({ legalStructure: v })}
          options={LEGAL_STATUSES}
          icon={<Building2 className="h-3 w-3" />}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SelectField
          label="Tax ID Status"
          value={profile.taxId}
          onChange={(v) => onChange({ taxId: v })}
          options={[
            { value: "have", label: "Have a tax ID / BIR number" },
            { value: "applying", label: "Applying for one" },
            { value: "dont-have", label: "Don't have one yet" },
          ]}
          icon={<Shield className="h-3 w-3" />}
        />
        <SelectField
          label="Business Bank Account"
          value={profile.bankAccount}
          onChange={(v) => onChange({ bankAccount: v })}
          options={[
            { value: "have", label: "Have a business account" },
            { value: "personal", label: "Using personal account" },
            { value: "none", label: "No bank account yet" },
          ]}
          icon={<Wallet className="h-3 w-3" />}
        />
      </div>

      <TextAreaField
        label="Licenses Required"
        value={profile.licensesRequired}
        onChange={(v) => onChange({ licensesRequired: v })}
        placeholder="What licenses or permits does your business need?"
        icon={<Shield className="h-3 w-3" />}
        maxLength={500}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SelectField
          label="Insurance Status"
          value={profile.insuranceStatus}
          onChange={(v) => onChange({ insuranceStatus: v })}
          options={[
            { value: "have", label: "Have business insurance" },
            { value: "looking", label: "Looking into it" },
            { value: "none", label: "No insurance" },
            { value: "na", label: "Not applicable" },
          ]}
          icon={<Shield className="h-3 w-3" />}
        />
        <SelectField
          label="Contracts in Place"
          value={profile.contractsInPlace}
          onChange={(v) => onChange({ contractsInPlace: v })}
          options={[
            { value: "yes", label: "Yes, standard contracts" },
            { value: "some", label: "Some contracts" },
            { value: "none", label: "No contracts yet" },
          ]}
          icon={<Shield className="h-3 w-3" />}
        />
      </div>

      <ToggleField
        label="Do you collect customer data?"
        value={profile.collectsCustomerData}
        onChange={(v) => onChange({ collectsCustomerData: v })}
        tooltip="Names, emails, payment info, addresses, etc."
        icon={<Users className="h-3 w-3" />}
      />

      {profile.collectsCustomerData && (
        <div className="p-4 rounded-xl bg-amber-500/5 border border-amber-500/20 space-y-4">
          <p className="text-xs text-amber-400 font-medium">Data Protection</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <SelectField
              label="Privacy Policy"
              value={profile.privacyPolicy}
              onChange={(v) => onChange({ privacyPolicy: v })}
              options={[
                { value: "have", label: "Have one in place" },
                { value: "draft", label: "In draft" },
                { value: "none", label: "Don't have one" },
              ]}
              icon={<Shield className="h-3 w-3" />}
            />
            <SelectField
              label="Terms of Service"
              value={profile.termsOfService}
              onChange={(v) => onChange({ termsOfService: v })}
              options={[
                { value: "have", label: "Have one in place" },
                { value: "draft", label: "In draft" },
                { value: "none", label: "Don't have one" },
              ]}
              icon={<Shield className="h-3 w-3" />}
            />
          </div>
          <TextAreaField
            label="Data Security Measures"
            value={profile.dataSecurityMeasures}
            onChange={(v) => onChange({ dataSecurityMeasures: v })}
            placeholder="How do you protect customer data?"
            icon={<Shield className="h-3 w-3" />}
            maxLength={500}
          />
        </div>
      )}

      <SelectField
        label="Bookkeeping Method"
        value={profile.bookkeepingMethod}
        onChange={(v) => onChange({ bookkeepingMethod: v })}
        options={[
          { value: "professional", label: "Professional accountant" },
          { value: "software", label: "Accounting software" },
          { value: "spreadsheet", label: "Spreadsheet / Manual" },
          { value: "none", label: "No bookkeeping yet" },
        ]}
        icon={<DollarSign className="h-3 w-3" />}
      />
    </div>
  );
}

export function GrowthAcquisitionStep({ profile, onChange }: StepProps) {
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <TrendingUp className="h-4 w-4" style={{ color: "hsl(var(--kf-accent1))" }} />
        Growth & Acquisition
      </div>
      <p className="text-xs text-muted-foreground">How you attract and retain customers.</p>

      <TextField
        label="Primary Lead Source"
        value={profile.leadSource}
        onChange={(v) => onChange({ leadSource: v })}
        placeholder="Where do most of your leads come from?"
        tooltip="Your most effective channel for finding new customers"
        icon={<TrendingUp className="h-3 w-3" />}
      />

      <MultiSelect
        label="Marketing Channels"
        selected={profile.marketingChannels}
        onChange={(v) => onChange({ marketingChannels: v })}
        options={MARKETING_CHANNEL_OPTIONS}
        tooltip="Select all channels you currently use or plan to use"
        icon={<Globe className="h-3 w-3" />}
      />

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <ToggleField label="CRM System" value={profile.hasCrm} onChange={(v) => onChange({ hasCrm: v })} />
        <ToggleField label="Sales Pipeline" value={profile.hasPipeline} onChange={(v) => onChange({ hasPipeline: v })} />
        <ToggleField label="Conversion Tracking" value={profile.hasConversionTracking} onChange={(v) => onChange({ hasConversionTracking: v })} />
        <ToggleField label="Referral Program" value={profile.hasReferralProgram} onChange={(v) => onChange({ hasReferralProgram: v })} />
        <ToggleField label="Paid Advertising" value={profile.usesAds} onChange={(v) => onChange({ usesAds: v })} />
        <ToggleField label="Content Strategy" value={profile.hasContentStrategy} onChange={(v) => onChange({ hasContentStrategy: v })} />
        <ToggleField label="Partnerships" value={profile.hasPartnerships} onChange={(v) => onChange({ hasPartnerships: v })} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <NumberField
          label="Email List Size"
          value={profile.emailListSize}
          onChange={(v) => onChange({ emailListSize: v })}
          placeholder="Number of subscribers"
          icon={<Users className="h-3 w-3" />}
          min={0}
        />
        <NumberField
          label="Monthly Leads"
          value={profile.monthlyLeads}
          onChange={(v) => onChange({ monthlyLeads: v })}
          placeholder="Leads per month"
          icon={<TrendingUp className="h-3 w-3" />}
          min={0}
        />
      </div>

      <NumberField
        label="Conversion Rate (%)"
        value={profile.conversionRate}
        onChange={(v) => onChange({ conversionRate: v })}
        placeholder="e.g., 5"
        tooltip="What percentage of leads become paying customers?"
        icon={<Target className="h-3 w-3" />}
        min={0}
        max={100}
      />

      <TextAreaField
        label="Retention Strategy"
        value={profile.retentionStrategy}
        onChange={(v) => onChange({ retentionStrategy: v })}
        placeholder="What do you do to keep customers long-term?"
        icon={<Users className="h-3 w-3" />}
        maxLength={500}
      />
    </div>
  );
}

export function ConstraintsGoalsStep({ profile, onChange }: StepProps) {
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Target className="h-4 w-4" style={{ color: "hsl(var(--kf-accent1))" }} />
        Constraints & Goals
      </div>
      <p className="text-xs text-muted-foreground">What's holding you back and where do you want to go?</p>

      <TextAreaField
        label="Biggest Challenges"
        value={profile.biggestChallenges}
        onChange={(v) => onChange({ biggestChallenges: v })}
        placeholder="What are the biggest obstacles facing your business right now?"
        tooltip="Be honest — this helps us give better recommendations"
        icon={<AlertCircle className="h-3 w-3" />}
        rows={4}
        maxLength={1000}
      />

      <TextAreaField
        label="Short-Term Goals (3-6 months)"
        value={profile.shortTermGoals}
        onChange={(v) => onChange({ shortTermGoals: v })}
        placeholder="What do you want to achieve in the next 3-6 months?"
        icon={<Target className="h-3 w-3" />}
        maxLength={500}
      />

      <TextAreaField
        label="Medium-Term Goals (1-2 years)"
        value={profile.mediumTermGoals}
        onChange={(v) => onChange({ mediumTermGoals: v })}
        placeholder="Where do you see your business in 1-2 years?"
        icon={<Target className="h-3 w-3" />}
        maxLength={500}
      />

      <TextAreaField
        label="Definition of Success"
        value={profile.definitionOfSuccess}
        onChange={(v) => onChange({ definitionOfSuccess: v })}
        placeholder="What does success look like for you? Revenue target, lifestyle, impact?"
        tooltip="This helps shape recommendations around what matters to you"
        icon={<Sparkles className="h-3 w-3" />}
        maxLength={500}
      />

      <SliderField
        label="Urgency Level"
        value={profile.urgencyLevel}
        onChange={(v) => onChange({ urgencyLevel: v })}
        labels={["No rush", "Low", "Moderate", "High", "Critical"]}
        tooltip="How urgently do you need to see results?"
        icon={<Clock className="h-3 w-3" />}
      />
    </div>
  );
}

export function ReviewStep({
  profile,
  onNavigateToStep,
  onSubmit,
  submitting,
  submitError,
}: {
  profile: GuidanceProfile;
  onNavigateToStep: (step: number) => void;
  onSubmit: () => void;
  submitting: boolean;
  submitError?: string | null;
}) {
  const completionMap = getStepCompletionMap(profile);

  const sections = [
    { step: 1, label: "Founder Context", icon: User, fields: [
      { label: "Name", value: profile.founderName },
      { label: "Role", value: profile.founderRole },
      { label: "Experience", value: profile.experienceLevel },
      { label: "Primary Goal", value: profile.primaryGoal },
    ]},
    { step: 2, label: "Business Identity", icon: Building2, fields: [
      { label: "Business Name", value: profile.businessName },
      { label: "Industry", value: profile.industry },
      { label: "Stage", value: profile.businessStage },
      { label: "Type", value: profile.businessType },
    ]},
    { step: 3, label: "Offer Definition", icon: Package, fields: [
      { label: "Offer Name", value: profile.offerName },
      { label: "Description", value: profile.offerDescription },
      { label: "Problem Solved", value: profile.problemSolved },
    ]},
    { step: 4, label: "Customer Definition", icon: Users, fields: [
      { label: "Ideal Customer", value: profile.idealCustomer },
      { label: "B2B/B2C", value: profile.b2bOrB2c },
      { label: "Pain Points", value: profile.painPoints },
    ]},
    { step: 5, label: "Revenue Model", icon: DollarSign, fields: [
      { label: "Model", value: profile.revenueModelType },
      { label: "Pricing", value: profile.pricingModel },
      { label: "Price Range", value: profile.priceRange },
    ]},
    { step: 6, label: "Cost & Finance", icon: Wallet, fields: [
      { label: "Funding Source", value: profile.fundingSource },
      { label: "Revenue Target", value: profile.revenueTarget ? `TTD ${profile.revenueTarget.toLocaleString()}` : "" },
    ]},
    { step: 7, label: "Operations", icon: Settings, fields: [
      { label: "Fulfillment", value: profile.fulfillmentModel },
      { label: "Tools", value: profile.tools.join(", ") },
    ]},
    { step: 8, label: "Legal & Compliance", icon: Shield, fields: [
      { label: "Registration", value: profile.registrationStatus },
      { label: "Structure", value: profile.legalStructure },
    ]},
    { step: 9, label: "Growth & Acquisition", icon: TrendingUp, fields: [
      { label: "Lead Source", value: profile.leadSource },
      { label: "Channels", value: profile.marketingChannels.join(", ") },
    ]},
    { step: 10, label: "Constraints & Goals", icon: Target, fields: [
      { label: "Challenges", value: profile.biggestChallenges },
      { label: "Short-Term Goals", value: profile.shortTermGoals },
    ]},
  ];

  const incompleteCount = Object.values(completionMap).filter((v) => !v).length;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <CheckCircle2 className="h-4 w-4" style={{ color: "hsl(var(--kf-accent1))" }} />
        Review Your Profile
      </div>
      <p className="text-xs text-muted-foreground">
        Review your answers before generating your assessment.
        {incompleteCount > 0 && (
          <span className="text-amber-400 ml-1">
            {incompleteCount} section{incompleteCount > 1 ? "s" : ""} need{incompleteCount === 1 ? "s" : ""} more detail.
          </span>
        )}
      </p>

      <div className="space-y-3">
        {sections.map((section) => {
          const Icon = section.icon;
          const isComplete = completionMap[section.step];
          const hasData = section.fields.some((f) => f.value && f.value.trim() !== "");

          return (
            <div
              key={section.step}
              className={`p-4 rounded-xl border transition-all ${
                isComplete
                  ? "bg-emerald-500/5 border-emerald-500/20"
                  : "bg-amber-500/5 border-amber-500/20"
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4" style={{ color: isComplete ? "rgb(16 185 129)" : "rgb(245 158 11)" }} />
                  <span className="text-xs font-semibold">{section.label}</span>
                  {isComplete ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                  ) : (
                    <AlertCircle className="h-3.5 w-3.5 text-amber-500" />
                  )}
                </div>
                <button
                  onClick={() => onNavigateToStep(section.step)}
                  className="flex items-center gap-1 text-[11px] text-[hsl(var(--kf-accent1))] hover:underline font-medium min-h-[44px] px-2"
                >
                  Edit <ChevronRight className="h-3 w-3" />
                </button>
              </div>
              {hasData && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {section.fields.map((field) => (
                    field.value ? (
                      <div key={field.label} className="text-[11px]">
                        <span className="text-muted-foreground">{field.label}: </span>
                        <span className="text-foreground font-medium">
                          {field.value.length > 60 ? field.value.substring(0, 60) + "..." : field.value}
                        </span>
                      </div>
                    ) : null
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="pt-4 border-t border-border/30 space-y-3">
        {submitError && (
          <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20">
            <p className="text-xs text-red-400">{submitError}</p>
          </div>
        )}
        <Button
          onClick={onSubmit}
          disabled={submitting}
          className="w-full min-h-[48px] text-base"
        >
          <span className="flex items-center gap-2">
            {submitting ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Submitting to Analysis Engine...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                Generate Business Analysis
              </>
            )}
          </span>
        </Button>
      </div>
    </div>
  );
}

export function GenerateStep() {
  return (
    <div className="space-y-6 text-center max-w-md mx-auto py-8">
      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center mx-auto shadow-lg">
        <CheckCircle2 className="w-8 h-8 text-white" />
      </div>
      <div>
        <h2 className="text-xl font-bold">Assessment Submitted!</h2>
        <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
          Your business profile has been submitted for analysis. You'll receive personalized
          recommendations, risk assessments, and growth strategies based on your responses.
        </p>
      </div>
      <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
        <p className="text-xs text-emerald-400 font-medium">
          Your dashboard will be available shortly with detailed insights and action items.
        </p>
      </div>
    </div>
  );
}
