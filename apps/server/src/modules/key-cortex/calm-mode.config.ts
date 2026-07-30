/**
 * KEY Calm Mode Configuration
 * Feature visibility by user tier — progressive disclosure system.
 *
 * Beginner (Calm):  ~30% of features visible
 * Intermediate:      ~60% of features visible
 * Advanced:          100% of features visible
 */

import { FeatureVisibility, UserTier } from './cortex-genome-contracts';
export { UserTier } from './cortex-genome-contracts';

export const CALM_MODE_FEATURES: FeatureVisibility[] = [
  // ═══════════════════════════════════════════════════════════
  // CRM
  // ═══════════════════════════════════════════════════════════
  { featureId: 'crm.contacts.list', module: 'crm', beginner: true, intermediate: true, advanced: true },
  { featureId: 'crm.contacts.add', module: 'crm', beginner: true, intermediate: true, advanced: true },
  { featureId: 'crm.contacts.search', module: 'crm', beginner: true, intermediate: true, advanced: true },
  { featureId: 'crm.contacts.detail', module: 'crm', beginner: true, intermediate: true, advanced: true },
  { featureId: 'crm.pipelines', module: 'crm', beginner: false, intermediate: true, advanced: true, unlockCriteria: { usageCount: 10 } },
  { featureId: 'crm.automation', module: 'crm', beginner: false, intermediate: false, advanced: true, unlockCriteria: { daysActive: 14 } },
  { featureId: 'crm.import', module: 'crm', beginner: false, intermediate: true, advanced: true },
  { featureId: 'crm.customFields', module: 'crm', beginner: false, intermediate: false, advanced: true, unlockCriteria: { daysActive: 30 } },
  { featureId: 'crm.merge', module: 'crm', beginner: false, intermediate: true, advanced: true },

  // ═══════════════════════════════════════════════════════════
  // Invoicing
  // ═══════════════════════════════════════════════════════════
  { featureId: 'invoice.create', module: 'invoicing', beginner: true, intermediate: true, advanced: true },
  { featureId: 'invoice.list', module: 'invoicing', beginner: true, intermediate: true, advanced: true },
  { featureId: 'invoice.view', module: 'invoicing', beginner: true, intermediate: true, advanced: true },
  { featureId: 'invoice.markPaid', module: 'invoicing', beginner: true, intermediate: true, advanced: true },
  { featureId: 'invoice.templates', module: 'invoicing', beginner: false, intermediate: true, advanced: true },
  { featureId: 'invoice.recurring', module: 'invoicing', beginner: false, intermediate: true, advanced: true, unlockCriteria: { usageCount: 5 } },
  { featureId: 'invoice.multiCurrency', module: 'invoicing', beginner: false, intermediate: false, advanced: true },
  { featureId: 'invoice.reminders', module: 'invoicing', beginner: false, intermediate: true, advanced: true },

  // ═══════════════════════════════════════════════════════════
  // Bookings
  // ═══════════════════════════════════════════════════════════
  { featureId: 'booking.calendar', module: 'bookings', beginner: true, intermediate: true, advanced: true },
  { featureId: 'booking.create', module: 'bookings', beginner: true, intermediate: true, advanced: true },
  { featureId: 'booking.availability', module: 'bookings', beginner: true, intermediate: true, advanced: true },
  { featureId: 'booking.widget', module: 'bookings', beginner: false, intermediate: true, advanced: true, unlockCriteria: { daysActive: 3 } },
  { featureId: 'booking.services', module: 'bookings', beginner: false, intermediate: true, advanced: true },
  { featureId: 'booking.staff', module: 'bookings', beginner: false, intermediate: true, advanced: true },

  // ═══════════════════════════════════════════════════════════
  // Marketing
  // ═══════════════════════════════════════════════════════════
  { featureId: 'marketing.campaigns', module: 'marketing', beginner: false, intermediate: true, advanced: true },
  { featureId: 'marketing.email', module: 'marketing', beginner: false, intermediate: true, advanced: true },
  { featureId: 'marketing.social', module: 'marketing', beginner: false, intermediate: true, advanced: true },
  { featureId: 'marketing.automation', module: 'marketing', beginner: false, intermediate: false, advanced: true, unlockCriteria: { daysActive: 21 } },

  // ═══════════════════════════════════════════════════════════
  // Storefront
  // ═══════════════════════════════════════════════════════════
  { featureId: 'storefront.products', module: 'storefront', beginner: true, intermediate: true, advanced: true },
  { featureId: 'storefront.orders', module: 'storefront', beginner: true, intermediate: true, advanced: true },
  { featureId: 'storefront.checkout', module: 'storefront', beginner: false, intermediate: true, advanced: true },

  // ═══════════════════════════════════════════════════════════
  // Expenses
  // ═══════════════════════════════════════════════════════════
  { featureId: 'expense.log', module: 'expenses', beginner: true, intermediate: true, advanced: true },
  { featureId: 'expense.categories', module: 'expenses', beginner: false, intermediate: true, advanced: true },
  { featureId: 'expense.receipts', module: 'expenses', beginner: false, intermediate: true, advanced: true },

  // ═══════════════════════════════════════════════════════════
  // Projects
  // ═══════════════════════════════════════════════════════════
  { featureId: 'project.list', module: 'projects', beginner: true, intermediate: true, advanced: true },
  { featureId: 'project.create', module: 'projects', beginner: false, intermediate: true, advanced: true },
  { featureId: 'project.tasks', module: 'projects', beginner: false, intermediate: true, advanced: true },
  { featureId: 'project.timeline', module: 'projects', beginner: false, intermediate: true, advanced: true },
  { featureId: 'project.budget', module: 'projects', beginner: false, intermediate: false, advanced: true },

  // ═══════════════════════════════════════════════════════════
  // Reporting
  // ═══════════════════════════════════════════════════════════
  { featureId: 'report.dashboard', module: 'reporting', beginner: true, intermediate: true, advanced: true },
  { featureId: 'report.revenue', module: 'reporting', beginner: false, intermediate: true, advanced: true },
  { featureId: 'report.custom', module: 'reporting', beginner: false, intermediate: false, advanced: true, unlockCriteria: { daysActive: 14 } },

  // ═══════════════════════════════════════════════════════════
  // Command Center
  // ═══════════════════════════════════════════════════════════
  { featureId: 'cc.revenue', module: 'commandCenter', beginner: true, intermediate: true, advanced: true },
  { featureId: 'cc.tasks', module: 'commandCenter', beginner: true, intermediate: true, advanced: true },
  { featureId: 'cc.inbox', module: 'commandCenter', beginner: true, intermediate: true, advanced: true },
  { featureId: 'cc.aiBriefing', module: 'commandCenter', beginner: true, intermediate: true, advanced: true },
  { featureId: 'cc.bookings', module: 'commandCenter', beginner: false, intermediate: true, advanced: true },
  { featureId: 'cc.genome', module: 'commandCenter', beginner: false, intermediate: false, advanced: true },

  // ═══════════════════════════════════════════════════════════
  // AI / KeyCortex
  // ═══════════════════════════════════════════════════════════
  { featureId: 'ai.chat', module: 'ai', beginner: true, intermediate: true, advanced: true },
  { featureId: 'ai.voice', module: 'ai', beginner: false, intermediate: true, advanced: true },
  { featureId: 'ai.personalities', module: 'ai', beginner: false, intermediate: true, advanced: true },
  { featureId: 'ai.autonomy', module: 'ai', beginner: false, intermediate: false, advanced: true, unlockCriteria: { daysActive: 30 } },
  { featureId: 'ai.proactive', module: 'ai', beginner: false, intermediate: false, advanced: true, unlockCriteria: { daysActive: 21 } },
];

// ═══════════════════════════════════════════════════════════
// Helper: Check if a feature is visible for a tier
// ═══════════════════════════════════════════════════════════

export function isFeatureVisible(
  featureId: string,
  tier: UserTier,
): boolean {
  const feature = CALM_MODE_FEATURES.find((f) => f.featureId === featureId);
  if (!feature) return true; // Unknown features default to visible

  switch (tier) {
    case 'beginner': return feature.beginner;
    case 'intermediate': return feature.intermediate;
    case 'advanced': return feature.advanced;
    default: return true;
  }
}

// ═══════════════════════════════════════════════════════════
// Helper: Get visible features for a module at a tier
// ═══════════════════════════════════════════════════════════

export function getVisibleFeatures(
  module: string,
  tier: UserTier,
): FeatureVisibility[] {
  return CALM_MODE_FEATURES.filter(
    (f) => f.module === module && isFeatureVisible(f.featureId, tier),
  );
}

// ═══════════════════════════════════════════════════════════
// AI Entry Point Configuration
// ═══════════════════════════════════════════════════════════

export const AI_ENTRY_POINTS = {
  // One primary chat interface (the floating button)
  primary: { id: 'ai.chat', label: 'Ask KEY', icon: 'MessageSquare' },

  // Cmd+K command palette
  palette: { id: 'ai.palette', label: 'Command Palette', shortcut: 'Cmd+K' },

  // Removed (consolidated into primary):
  // - Per-module AI search bars
  // - Guide overlays
  // - Autocomplete suggestions
  // - Separate AI hub page
};
