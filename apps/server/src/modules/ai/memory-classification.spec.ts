/**
 * MEM-CLASS-COLUMNS (P125, D-257): unit tests for canonical memory data-class
 * restrictiveness lattice, module-scope normalization/union, and structural
 * provenance classifiers.
 */
import { describe, it, expect } from 'vitest';
import {
  MEMORY_ROW_DATA_CLASSES,
  MEMORY_DATA_CLASS_RANK,
  isMemoryRowDataClass,
  moreRestrictiveDataClass,
  mostRestrictiveDataClass,
  normalizeModuleScope,
  unionModuleScopes,
  mergeMemoryClassifications,
  classifyAiMemoryWrite,
  classifyTemporalEvent,
  classifyTemporalMemoryWrite,
  classifyEmbeddingWrite,
} from './memory-classification';

describe('MEM-CLASS-COLUMNS: data class lattice & module scope helpers', () => {
  it('defines the 5 canonical persisted data classes and strict restrictiveness ordering', () => {
    expect([...MEMORY_ROW_DATA_CLASSES]).toEqual([
      'GENERAL',
      'REVENUE',
      'PERSONAL',
      'SECRET_BEARING',
      'UNCLASSIFIED',
    ]);
    expect(MEMORY_DATA_CLASS_RANK.SECRET_BEARING).toBeGreaterThan(MEMORY_DATA_CLASS_RANK.PERSONAL);
    expect(MEMORY_DATA_CLASS_RANK.PERSONAL).toBeGreaterThan(MEMORY_DATA_CLASS_RANK.REVENUE);
    expect(MEMORY_DATA_CLASS_RANK.REVENUE).toBeGreaterThan(MEMORY_DATA_CLASS_RANK.UNCLASSIFIED);
    expect(MEMORY_DATA_CLASS_RANK.UNCLASSIFIED).toBeGreaterThan(MEMORY_DATA_CLASS_RANK.GENERAL);

    expect(isMemoryRowDataClass('REVENUE')).toBe(true);
    expect(isMemoryRowDataClass('MIXED')).toBe(false);
    expect(isMemoryRowDataClass(null)).toBe(false);
  });

  it('picks the most restrictive class across pairwise and multi-element merges', () => {
    expect(moreRestrictiveDataClass('GENERAL', 'UNCLASSIFIED')).toBe('UNCLASSIFIED');
    expect(moreRestrictiveDataClass('UNCLASSIFIED', 'REVENUE')).toBe('REVENUE');
    expect(moreRestrictiveDataClass('REVENUE', 'PERSONAL')).toBe('PERSONAL');
    expect(moreRestrictiveDataClass('PERSONAL', 'SECRET_BEARING')).toBe('SECRET_BEARING');
    expect(moreRestrictiveDataClass('SECRET_BEARING', 'GENERAL')).toBe('SECRET_BEARING');

    expect(mostRestrictiveDataClass(['GENERAL', 'REVENUE', 'UNCLASSIFIED'])).toBe('REVENUE');
    expect(mostRestrictiveDataClass(['GENERAL', null, undefined, 'PERSONAL', 'REVENUE'])).toBe('PERSONAL');
    expect(mostRestrictiveDataClass([])).toBe('UNCLASSIFIED');
    expect(mostRestrictiveDataClass([null, undefined])).toBe('UNCLASSIFIED');
    expect(mostRestrictiveDataClass([], 'GENERAL')).toBe('GENERAL');
  });

  it('normalizes aliases and produces deterministic sorted deduplicated moduleScope unions', () => {
    expect(normalizeModuleScope(['bookings', 'crm', 'bookings'])).toEqual(['bookings', 'crm']);
    expect(normalizeModuleScope(['commerce', 'finance', 'invoices'])).toEqual(['revenue']);
    expect(normalizeModuleScope(['calendar', 'contacts', 'autopilot', 'whatsapp'])).toEqual([
      'automations',
      'bookings',
      'crm',
      'operations',
    ]);
    expect(normalizeModuleScope(['', null, undefined, 'not_a_real_module_xyz'])).toEqual([]);

    expect(
      unionModuleScopes(['revenue', 'crm'], ['bookings', 'crm'], null, ['operations']),
    ).toEqual(['bookings', 'crm', 'operations', 'revenue']);
  });

  it('merges classifications by taking most restrictive class and union of module scopes', () => {
    const merged = mergeMemoryClassifications([
      { dataClass: 'GENERAL', moduleScope: ['operations'] },
      { dataClass: 'REVENUE', moduleScope: ['revenue', 'crm'] },
      null,
    ]);
    expect(merged).toEqual({
      dataClass: 'REVENUE',
      moduleScope: ['crm', 'operations', 'revenue'],
    });
  });
});

describe('MEM-CLASS-COLUMNS: classifyAiMemoryWrite', () => {
  it('classifies settings rows structurally (BYOK preferences as SECRET_BEARING, autonomy/routing as GENERAL)', () => {
    expect(
      classifyAiMemoryWrite({
        category: 'settings',
        key: 'ai_preferences',
        value: '{"byokOpenai":"enc:..."}',
      }),
    ).toEqual({ dataClass: 'SECRET_BEARING', moduleScope: ['ai', 'settings'] });

    expect(
      classifyAiMemoryWrite({
        category: 'settings',
        key: 'autonomy',
        value: '{"mode":"assisted"}',
      }),
    ).toEqual({ dataClass: 'GENERAL', moduleScope: ['ai', 'settings'] });

    expect(
      classifyAiMemoryWrite({
        category: 'settings',
        key: 'routing_table',
        value: '{}',
      }),
    ).toEqual({ dataClass: 'GENERAL', moduleScope: ['ai', 'settings'] });
  });

  it('classifies document_extraction as REVENUE scoped to revenue', () => {
    expect(
      classifyAiMemoryWrite({
        category: 'document_extraction',
        key: 'doc_123',
        value: '{"data":{"vendor":"Acme"}}',
        source: 'role_engine',
      }),
    ).toEqual({ dataClass: 'REVENUE', moduleScope: ['revenue'] });
  });

  it('classifies ordinary business preferences as GENERAL with empty moduleScope', () => {
    expect(
      classifyAiMemoryWrite({
        category: 'tone',
        key: 'preferred',
        value: 'warm and concise',
        source: 'user',
      }),
    ).toEqual({ dataClass: 'GENERAL', moduleScope: [] });

    expect(
      classifyAiMemoryWrite({
        category: 'goals',
        key: 'q4_focus',
        value: 'improve customer onboarding speed',
        source: 'user',
      }),
    ).toEqual({ dataClass: 'GENERAL', moduleScope: [] });
  });

  it('elevates money-bearing patterns and revenue tool lessons to REVENUE', () => {
    const overdue = classifyAiMemoryWrite({
      category: 'patterns',
      key: 'pattern_overdue_invoice_cluster_1',
      value: JSON.stringify({ title: 'Repeat late payer', description: '3 overdue invoices totaling $4,200' }),
      source: 'pattern_analysis',
    });
    expect(overdue.dataClass).toBe('REVENUE');
    expect(overdue.moduleScope).toContain('revenue');

    const invoiceLesson = classifyAiMemoryWrite({
      category: 'learned_corrections',
      key: 'commerce_create_invoice:validation_error',
      value: '{"learnedPattern":"Check currency before calling commerce_create_invoice"}',
      source: 'pattern_analysis',
    });
    expect(invoiceLesson.dataClass).toBe('REVENUE');
    expect(invoiceLesson.moduleScope).toContain('revenue');
  });

  it('classifies non-financial module patterns and lessons with their canonical moduleScope', () => {
    const crmLesson = classifyAiMemoryWrite({
      category: 'learned_corrections',
      key: 'crm_create_contact:not_found',
      value: '{"learnedPattern":"Search before calling crm_create_contact"}',
      source: 'pattern_analysis',
    });
    expect(crmLesson).toEqual({ dataClass: 'GENERAL', moduleScope: ['crm'] });
  });

  it('classifies user_preference or explicit userId rows as PERSONAL', () => {
    const pref = classifyAiMemoryWrite({
      category: 'user_preference',
      key: 'summary_length',
      value: 'short',
      userId: 'user_1',
    });
    expect(pref.dataClass).toBe('PERSONAL');
  });

  it('falls back to UNCLASSIFIED for unknown categories and never weakens explicitDataClass', () => {
    const unknown = classifyAiMemoryWrite({
      category: 'totally_unknown_category',
      key: 'opaque_key',
      value: 'opaque text',
    });
    expect(unknown.dataClass).toBe('UNCLASSIFIED');

    const pinned = classifyAiMemoryWrite({
      category: 'tone',
      key: 'preferred',
      value: 'concise',
      explicitDataClass: 'REVENUE',
      explicitModuleScope: ['revenue'],
    });
    expect(pinned).toEqual({ dataClass: 'REVENUE', moduleScope: ['revenue'] });
  });
});

describe('MEM-CLASS-COLUMNS: classifyTemporalEvent & classifyTemporalMemoryWrite', () => {
  it('taints a thread summary as REVENUE with union of module scopes when any source event is a payment event', () => {
    const whatsappEv = {
      id: 'ev_1',
      source: 'whatsapp',
      type: 'key_inbox.message_received',
      module: 'operations',
      entityType: 'thread',
      title: 'Customer asked about appointment',
      summary: null,
      description: null,
    };
    const paymentEv = {
      id: 'ev_2',
      source: 'payments',
      type: 'payment.received',
      module: 'revenue',
      entityType: 'payment',
      title: 'Payment received $250',
      summary: null,
      description: null,
    };

    expect(classifyTemporalEvent(whatsappEv)).toEqual({
      dataClass: 'GENERAL',
      moduleScope: ['operations'],
    });
    expect(classifyTemporalEvent(paymentEv)).toEqual({
      dataClass: 'REVENUE',
      moduleScope: ['revenue'],
    });

    const summary = classifyTemporalMemoryWrite({
      entityType: 'thread',
      entityId: 'thread_1',
      type: 'summary',
      sourceModule: 'key_inbox',
      content: 'Thread activity: 2 event(s) across whatsapp, payments.',
      sourceEvents: [whatsappEv, paymentEv],
    });
    expect(summary).toEqual({
      dataClass: 'REVENUE',
      moduleScope: ['operations', 'revenue'],
    });
  });

  it('keeps a clean booking thread summary GENERAL with union of bookings and operations', () => {
    const bookingEv = {
      id: 'ev_3',
      source: 'calendar',
      type: 'booking.confirmed',
      module: 'bookings',
      entityType: 'booking',
      title: 'Booking confirmed for Tuesday',
      summary: null,
      description: null,
    };
    const summary = classifyTemporalMemoryWrite({
      entityType: 'thread',
      entityId: 'thread_2',
      type: 'summary',
      sourceModule: 'key_inbox',
      content: 'Thread activity: 1 event(s) across calendar.',
      sourceEvents: [bookingEv],
    });
    expect(summary).toEqual({
      dataClass: 'GENERAL',
      moduleScope: ['bookings', 'operations'],
    });
  });

  it('marks opaque key_cortex business memories UNCLASSIFIED unless money elevates them to REVENUE', () => {
    const opaque = classifyTemporalMemoryWrite({
      entityType: 'business',
      entityId: 'misc_note',
      type: 'insight',
      sourceModule: 'key_cortex',
      content: '{"note":"remember to check lobby signage"}',
    });
    expect(opaque.dataClass).toBe('UNCLASSIFIED');

    const financial = classifyTemporalMemoryWrite({
      entityType: 'business',
      entityId: 'invoice_note',
      type: 'insight',
      sourceModule: 'key_cortex',
      content: '{"note":"Invoice #42 total $1,250 overdue"}',
    });
    expect(financial.dataClass).toBe('REVENUE');
    expect(financial.moduleScope).toContain('revenue');
  });
});

describe('MEM-CLASS-COLUMNS: classifyEmbeddingWrite', () => {
  it('inherits most restrictive dataClass and union of moduleScope from source row', () => {
    expect(
      classifyEmbeddingWrite({
        sourceType: 'memory',
        content: 'ordinary text',
        sourceDataClass: 'REVENUE',
        sourceModuleScope: ['revenue'],
        explicitDataClass: 'GENERAL',
        explicitModuleScope: ['crm'],
      }),
    ).toEqual({
      dataClass: 'REVENUE',
      moduleScope: ['crm', 'revenue'],
    });

    expect(
      classifyEmbeddingWrite({
        sourceType: 'document',
        content: 'Company handbook page 1',
      }),
    ).toEqual({
      dataClass: 'UNCLASSIFIED',
      moduleScope: ['expenses', 'revenue'],
    });

    expect(
      classifyEmbeddingWrite({
        sourceType: 'conversation',
        content: 'User asked about vacation schedule',
      }),
    ).toEqual({
      dataClass: 'PERSONAL',
      moduleScope: [],
    });
  });
});
