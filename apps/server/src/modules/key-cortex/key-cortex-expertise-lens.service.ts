import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import type {
  ExpertiseLens,
  ExpertiseLensKey,
  LensSelection,
  OutputFormat,
} from './key-cortex-expertise-lens.types';

/**
 * Selects the professional discipline KEY reasons in for a given task, and the
 * shape the answer should take.
 *
 * Selection is deterministic and local. It deliberately does not call a model:
 * this runs on every query, a model call would add latency and cost to each one,
 * and a deterministic selector can be tested exhaustively. The lens is a framing
 * hint for the downstream prompt, so a wrong-but-plausible choice degrades
 * politely rather than breaking anything.
 *
 * A lens grants no access. See key-cortex-expertise-lens.types.ts.
 */
@Injectable()
export class KeyCortexExpertiseLensService {
  private readonly logger = new Logger(KeyCortexExpertiseLensService.name);

  /** Cache of businessId -> JobRole names, to label lenses in the business's own words. */
  private readonly jobRoleCache = new Map<string, { names: string[]; at: number }>();
  private static readonly JOB_ROLE_TTL_MS = 5 * 60 * 1000;

  constructor(private readonly prisma: PrismaService) {}

  private static readonly LENSES: Record<ExpertiseLensKey, ExpertiseLens> = {
    finance: {
      key: 'finance',
      label: 'Finance',
      framing:
        'Reason as a finance professional. Work from figures, reconcile before concluding, ' +
        'separate cash from accrual, and state the period any number covers.',
      standardChecks: [
        'Do the totals reconcile?',
        'What period does this cover?',
        'Cash or accrual?',
        'Any outliers distorting the average?',
      ],
      defaultFormat: 'table',
    },
    sales: {
      key: 'sales',
      label: 'Sales',
      framing:
        'Reason as a sales lead. Think in pipeline stages, conversion and cycle time, ' +
        'and tie any recommendation to a specific next action on a specific deal.',
      standardChecks: [
        'Which stage is the bottleneck?',
        'What is the conversion rate between stages?',
        'Which deals are stalled and why?',
      ],
      defaultFormat: 'findings',
    },
    marketing: {
      key: 'marketing',
      label: 'Marketing',
      framing:
        'Reason as a marketer. Think in audience, channel, message and measurement. ' +
        'Distinguish reach from engagement from conversion.',
      standardChecks: [
        'Who is the audience?',
        'Which channel and why?',
        'What is the measurable outcome?',
      ],
      defaultFormat: 'options',
    },
    operations: {
      key: 'operations',
      label: 'Operations',
      framing:
        'Reason as an operations lead. Think in process steps, handoffs, capacity and ' +
        'failure points. Prefer concrete sequenced actions over general advice.',
      standardChecks: [
        'What is the current step-by-step process?',
        'Where is the handoff or bottleneck?',
        'What happens when it fails?',
      ],
      defaultFormat: 'checklist',
    },
    people: {
      key: 'people',
      label: 'People',
      framing:
        'Reason as an HR/people lead. Consider fairness, consistency of treatment, ' +
        'documentation, and obligations to the individual as well as the business.',
      standardChecks: [
        'Is this consistent with how others were treated?',
        'Is it documented?',
        'What does the individual need to know?',
      ],
      defaultFormat: 'checklist',
    },
    legal: {
      key: 'legal',
      label: 'Legal & compliance',
      framing:
        'Reason as a compliance-minded advisor. Identify obligations, retention and ' +
        'consent requirements, and flag where qualified professional advice is needed. ' +
        'Do not present conclusions as legal advice.',
      standardChecks: [
        'What obligation or regulation applies?',
        'What must be retained, and for how long?',
        'Where is professional advice required?',
      ],
      defaultFormat: 'findings',
    },
    support: {
      key: 'support',
      label: 'Customer support',
      framing:
        'Reason as a support lead. Prioritise resolving the customer situation, then ' +
        'the underlying cause. Be specific about what the customer is told.',
      standardChecks: [
        'What does the customer need right now?',
        'What caused it?',
        'What stops it recurring?',
      ],
      defaultFormat: 'checklist',
    },
    strategy: {
      key: 'strategy',
      label: 'Strategy',
      framing:
        'Reason as a strategist. Work at the level of position, tradeoffs and second-order ' +
        'effects. Always give the option not taken and what it would cost.',
      standardChecks: [
        'What are the real alternatives?',
        'What does each cost, and what does it foreclose?',
        'What would have to be true for this to work?',
      ],
      defaultFormat: 'options',
    },
    technical: {
      key: 'technical',
      label: 'Technical',
      framing:
        'Reason as an engineer. Be precise about cause and effect, distinguish what is ' +
        'observed from what is inferred, and state how a claim could be verified.',
      standardChecks: [
        'What is observed versus inferred?',
        'How would this be reproduced?',
        'What is the smallest change that tests the hypothesis?',
      ],
      defaultFormat: 'findings',
    },
    generalist: {
      key: 'generalist',
      label: 'General',
      framing:
        'Reason as a capable generalist. Answer directly, and say plainly when a ' +
        'specialist view would be needed.',
      standardChecks: ['What is actually being asked?', 'What would make this answerable?'],
      defaultFormat: 'narrative',
    },
  };

  /**
   * Signals per lens. Ordered scoring, most specific first — a term that belongs
   * to one discipline only is worth more than a term several share.
   */
  private static readonly SIGNALS: Array<{
    lens: ExpertiseLensKey;
    strong: string[];
    weak: string[];
  }> = [
    {
      lens: 'finance',
      strong: ['reconcile', 'reconciliation', 'invoice', 'vat', 'tax', 'ledger', 'payable', 'receivable', 'cash flow', 'margin', 'p&l', 'balance sheet', 'expense'],
      weak: ['revenue', 'cost', 'profit', 'payment', 'refund', 'budget'],
    },
    {
      lens: 'sales',
      strong: ['pipeline', 'deal', 'quota', 'lead conversion', 'close rate', 'prospect', 'upsell'],
      weak: ['lead', 'customer', 'quote', 'proposal'],
    },
    {
      lens: 'marketing',
      strong: ['campaign', 'audience', 'brand', 'seo', 'social media', 'newsletter', 'open rate', 'click-through'],
      weak: ['engagement', 'reach', 'content', 'post'],
    },
    {
      lens: 'operations',
      strong: ['roster', 'shift', 'inventory', 'stock', 'supply', 'scheduling', 'throughput', 'workflow', 'sop'],
      weak: ['process', 'capacity', 'delay', 'booking'],
    },
    {
      lens: 'people',
      strong: ['payroll', 'onboarding', 'grievance', 'appraisal', 'leave request', 'disciplinary', 'hiring', 'staff member'],
      weak: ['employee', 'team', 'training', 'absence'],
    },
    {
      lens: 'legal',
      strong: ['contract', 'liability', 'gdpr', 'compliance', 'consent', 'retention policy', 'terms of service', 'nda'],
      weak: ['policy', 'agreement', 'regulation', 'obligation'],
    },
    {
      lens: 'support',
      strong: ['complaint', 'ticket', 'refund request', 'escalation', 'sla', 'apolog'],
      weak: ['issue', 'customer said', 'unhappy', 'response time'],
    },
    {
      lens: 'strategy',
      strong: ['should we', 'competitor', 'market position', 'long term', 'expand', 'pivot', 'trade-off', 'tradeoff', 'prioriti'],
      weak: ['growth', 'opportunity', 'risk', 'decision', 'plan'],
    },
    {
      lens: 'technical',
      strong: ['error', 'bug', 'api', 'integration', 'database', 'deploy', 'latency', 'stack trace'],
      weak: ['sync', 'connector', 'failed', 'log'],
    },
  ];

  /** Task-shape signals that override a lens's default presentation. */
  private static readonly FORMAT_SIGNALS: Array<{ format: OutputFormat; terms: string[] }> = [
    { format: 'table', terms: ['reconcile', 'compare', 'breakdown', 'line by line', 'per month', 'by category'] },
    { format: 'options', terms: ['should we', 'or should', 'which option', 'alternatives', 'trade-off', 'tradeoff', 'decide between'] },
    { format: 'checklist', terms: ['how do i', 'how do we', 'steps', 'process for', 'what do i need to', 'walk me through'] },
    { format: 'findings', terms: ['why did', 'why is', 'what caused', 'diagnose', 'investigate', "what's wrong"] },
  ];

  /**
   * Choose the lens and presentation for a task.
   *
   * `businessId` is used only to label the lens in the business's own vocabulary
   * when one of its JobRoles matches. It never affects which lens is chosen, so
   * selection stays deterministic and independent of tenant data.
   */
  async select(task: string, businessId?: string): Promise<LensSelection> {
    const text = (task ?? '').toLowerCase().trim();

    if (!text) {
      return this.generalist('empty task');
    }

    let best: { lens: ExpertiseLensKey; score: number } | null = null;
    for (const sig of KeyCortexExpertiseLensService.SIGNALS) {
      let score = 0;
      for (const t of sig.strong) if (text.includes(t)) score += 3;
      for (const t of sig.weak) if (text.includes(t)) score += 1;
      if (score > 0 && (!best || score > best.score)) best = { lens: sig.lens, score };
    }

    if (!best) {
      return this.generalist('no discipline signals matched');
    }

    const lens = { ...KeyCortexExpertiseLensService.LENSES[best.lens] };
    const format = this.selectFormat(text, lens.defaultFormat);

    // Confidence rises with signal strength but is capped: this is a heuristic,
    // and overstating certainty would be misleading to anything consuming it.
    const confidence = Math.min(0.9, 0.4 + best.score * 0.1);

    const matchedJobRole = businessId
      ? await this.matchJobRoleLabel(businessId, best.lens)
      : undefined;
    if (matchedJobRole) lens.label = matchedJobRole;

    return {
      lens,
      format,
      confidence,
      rationale: `matched ${best.lens} signals (score ${best.score})`,
      ...(matchedJobRole ? { matchedJobRole } : {}),
    };
  }

  /** Prompt fragment for the chosen lens. Framing only — it confers no access. */
  buildPromptFraming(selection: LensSelection): string {
    const { lens, format } = selection;
    return [
      `Approach: ${lens.framing}`,
      `Consider: ${lens.standardChecks.join(' ')}`,
      `Present the answer as: ${this.describeFormat(format)}`,
    ].join('\n');
  }

  private describeFormat(format: OutputFormat): string {
    switch (format) {
      case 'table':
        return 'a table of the relevant figures, with a one-line takeaway underneath';
      case 'options':
        return 'the realistic options, each with its cost and what it rules out, then a recommendation';
      case 'checklist':
        return 'an ordered checklist of concrete steps';
      case 'findings':
        return 'findings, each with the evidence it rests on, most significant first';
      default:
        return 'a direct prose answer';
    }
  }

  private selectFormat(text: string, fallback: OutputFormat): OutputFormat {
    for (const sig of KeyCortexExpertiseLensService.FORMAT_SIGNALS) {
      if (sig.terms.some((t) => text.includes(t))) return sig.format;
    }
    return fallback;
  }

  private generalist(rationale: string): LensSelection {
    const lens = KeyCortexExpertiseLensService.LENSES.generalist;
    return { lens, format: lens.defaultFormat, confidence: 0.2, rationale };
  }

  /**
   * If the business defines a JobRole whose name resembles the chosen lens, use
   * that name as the label — a bakery says "Kitchen", a firm says "Practice".
   * Failure is non-fatal: labelling is cosmetic.
   */
  private async matchJobRoleLabel(
    businessId: string,
    lensKey: ExpertiseLensKey,
  ): Promise<string | undefined> {
    try {
      const cached = this.jobRoleCache.get(businessId);
      const fresh =
        cached && Date.now() - cached.at < KeyCortexExpertiseLensService.JOB_ROLE_TTL_MS;

      let names: string[];
      if (fresh && cached) {
        names = cached.names;
      } else {
        const roles = await this.prisma.client.jobRole.findMany({
          where: { businessId },
          select: { name: true },
          take: 100,
        });
        names = roles.map((r: { name: string }) => r.name).filter(Boolean);
        this.jobRoleCache.set(businessId, { names, at: Date.now() });
      }

      const key = lensKey.toLowerCase();
      return names.find((n) => {
        const l = n.toLowerCase();
        return l.includes(key) || key.includes(l);
      });
    } catch (err) {
      this.logger.debug(
        `JobRole labelling skipped for ${businessId}: ${(err as Error).message}`,
      );
      return undefined;
    }
  }
}
