import { apiGet, apiPostSimple as apiPost } from "@/lib/api";

export type OnboardingStep =
  | "welcome"
  | "intake"
  | "template"
  | "configure"
  | "genome"
  | "complete";

export interface OnboardingState {
  step: OnboardingStep;
  onboardingComplete: boolean;
  onboardingStartedAt: string | null;
  onboardingCompletedAt: string | null;
  threePillarMet: boolean;
  setupStatus: unknown;
  templateId?: string;
}

export interface ConciergeMessage {
  role: "assistant" | "user";
  content: string;
  quickReplies?: string[];
  actions?: Array<{
    id: string;
    label: string;
    type: "confirm" | "customize" | "skip" | "navigate";
    href?: string;
    data?: Record<string, unknown>;
  }>;
  setupStatus?: unknown;
  extracted?: Record<string, string>;
}

export interface ConciergeTemplate {
  id: string;
  label: string;
  keywords: string[];
}

export interface TemplatePreview {
  id: string;
  label: string;
  products: Array<{
    name: string;
    price: number;
    currency: string;
    category: string;
    duration?: number;
    description?: string;
  }>;
  businessHours: Record<string, { open: string; close: string; closed: boolean }>;
  paymentRecommendations: string[];
  emailTemplate: { subject: string; body: string };
}

export interface AutoConfigureResult {
  templateId: string;
  templateLabel: string;
  productsCreated?: number;
  productsSkipped?: boolean;
  businessHoursSet?: boolean;
  paymentMethodsSet?: boolean;
  storefrontEnabled?: boolean;
}

export interface DemoSeedResult {
  contactId: string;
  invoiceId: string;
  invoiceNumber: string;
}

export function fetchOnboardingState(businessId: string) {
  return apiGet<OnboardingState>(
    `/onboarding-concierge/businesses/${businessId}/onboarding-state`,
  );
}

export function saveOnboardingStep(businessId: string, step: OnboardingStep) {
  return apiPost<OnboardingState>(
    `/onboarding-concierge/businesses/${businessId}/onboarding-step`,
    { step },
  );
}

export function fetchConciergeWelcome(businessId: string) {
  return apiGet<ConciergeMessage>(
    `/onboarding-concierge/businesses/${businessId}/welcome`,
  );
}

export function sendConciergeMessage(
  businessId: string,
  message: string,
  history: Array<{ role: string; content: string }> = [],
) {
  return apiPost<ConciergeMessage>(
    `/onboarding-concierge/businesses/${businessId}/chat`,
    { message, history },
  );
}

export function fetchConciergeTemplates(businessId: string) {
  return apiGet<{ templates: ConciergeTemplate[] }>(
    `/onboarding-concierge/businesses/${businessId}/templates`,
  );
}

export function fetchConciergeTemplatePreview(businessId: string, templateId: string) {
  return apiGet<TemplatePreview>(
    `/onboarding-concierge/businesses/${businessId}/templates/${templateId}`,
  );
}

export function autoConfigureFromTemplate(
  businessId: string,
  templateId: string,
  options: {
    createProducts?: boolean;
    setBusinessHours?: boolean;
    setPaymentMethods?: boolean;
    configureStorefront?: boolean;
    customBusinessName?: string;
  } = {},
) {
  return apiPost<AutoConfigureResult>(
    `/onboarding-concierge/businesses/${businessId}/auto-configure`,
    { templateId, ...options },
  );
}

export function seedDemoData(businessId: string) {
  return apiPost<DemoSeedResult>(
    `/onboarding-concierge/businesses/${businessId}/seed-demo`,
    {},
  );
}

export function markOnboardingComplete(businessId: string) {
  return apiPost<{ complete: boolean; demoData: DemoSeedResult }>(
    `/onboarding-concierge/businesses/${businessId}/complete`,
    {},
  );
}
