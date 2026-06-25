import { Injectable, Logger } from '@nestjs/common';
import { BusinessFunction, KeyRoleBrain } from './key-mind.types';

/**
 * =============================================================================
 * Framework Engine — Injects Best-Practice Frameworks per Business Function
 * =============================================================================
 * Every business function has established frameworks. This service maps
 * functions to their frameworks and returns structured reasoning guidance.
 *
 * Examples:
 *   Sales issue → pipeline diagnosis, objection analysis, follow-up sequence
 *   Finance issue → cash flow, margin, unit economics
 *   Ops issue → bottleneck, SOP, capacity, handoff map
 * =============================================================================
 */

export interface BusinessFramework {
  /** Framework name (e.g. "SWOT Analysis") */
  name: string;
  /** One-line description of what this framework does */
  description: string;
  /** Ordered steps to work through */
  steps: string[];
}

@Injectable()
export class KeyFrameworkEngine {
  private readonly logger = new Logger(KeyFrameworkEngine.name);

  // Framework database: each function has multiple frameworks
  private readonly FRAMEWORKS: Record<BusinessFunction, BusinessFramework[]> = {
    strategy: [
      { name: 'Business Model Canvas', description: 'Map value proposition, customer segments, revenue streams, and cost structure on a single page.', steps: ['Value Proposition', 'Customer Segments', 'Channels', 'Customer Relationships', 'Revenue Streams', 'Key Resources', 'Key Activities', 'Key Partnerships', 'Cost Structure'] },
      { name: "Porter's Five Forces", description: 'Analyse competitive intensity and attractiveness of an industry or market.', steps: ['Threat of New Entrants', 'Bargaining Power of Suppliers', 'Bargaining Power of Buyers', 'Threat of Substitutes', 'Competitive Rivalry', 'Synthesis & Strategic Implications'] },
      { name: 'Blue Ocean Strategy', description: 'Find uncontested market space by reconstructing market boundaries.', steps: ['Eliminate — Which factors should the industry eliminate?', 'Reduce — Which factors should be reduced well below the standard?', 'Raise — Which factors should be raised well above the standard?', 'Create — Which factors should be created that the industry has never offered?', 'Validate — Is there a compelling blue ocean?'] },
      { name: 'SWOT Analysis', description: 'Assess internal strengths and weaknesses alongside external opportunities and threats.', steps: ['Strengths — What do we do well?', 'Weaknesses — Where can we improve?', 'Opportunities — What external trends favour us?', 'Threats — What external risks do we face?', 'Action Matrix — Match strengths to opportunities, mitigate weaknesses against threats'] },
    ],

    operations: [
      { name: 'Process Mapping', description: 'Visually document and analyse workflows to identify inefficiencies.', steps: ['Define process boundaries', 'Map each step in sequence', 'Identify decision points and handoffs', 'Measure cycle time and wait time at each step', 'Highlight bottlenecks and rework loops', 'Design improved process'] },
      { name: 'Bottleneck Analysis (TOC)', description: 'Apply Theory of Constraints to find and eliminate the constraint limiting throughput.', steps: ['Identify the system constraint', 'Exploit the constraint — maximise its utilisation', 'Subordinate everything else to the constraint', 'Elevate the constraint — increase its capacity', 'If broken, go back to step 1'] },
      { name: 'Lean Six Sigma (DMAIC)', description: 'Data-driven methodology to eliminate defects and reduce process variation.', steps: ['Define — Problem, scope, and goals', 'Measure — Baseline performance', 'Analyse — Root cause analysis', 'Improve — Implement solutions', 'Control — Sustain the gains'] },
      { name: 'Capacity Planning', description: 'Match production or service capacity with demand to avoid over- or under-utilisation.', steps: ['Forecast demand', 'Assess current capacity', 'Identify capacity gaps', 'Evaluate options — hire, outsource, automate, or expand', 'Implement and monitor'] },
    ],

    finance: [
      { name: 'Three-Statement Model', description: 'Integrated financial model linking income statement, balance sheet, and cash flow.', steps: ['Build revenue assumptions and projections', 'Project operating expenses', 'Construct the income statement', 'Model working capital and balance sheet items', 'Build the cash flow statement', 'Validate with sanity checks and ratios'] },
      { name: 'Unit Economics', description: 'Analyse revenue and cost on a per-unit basis to understand profitability at the micro level.', steps: ['Define the unit (customer, order, subscription)', 'Calculate Lifetime Value (LTV)', 'Calculate Customer Acquisition Cost (CAC)', 'Compute LTV:CAC ratio', 'Assess payback period', 'Model sensitivity to key assumptions'] },
      { name: 'Cash Flow Waterfall', description: 'Track cash inflows and outflows over time to identify liquidity risks and runway.', steps: ['Opening cash balance', 'Operating cash inflows', 'Operating cash outflows', 'Investing activities', 'Financing activities', 'Closing balance and runway projection'] },
      { name: 'Margin Analysis', description: 'Decompose profitability from gross margin down to net margin to find leakage.', steps: ['Revenue and gross margin', 'Operating expenses by category', 'Operating margin', 'Interest, tax, and other items', 'Net margin', 'Benchmark against industry peers'] },
      { name: 'DCF Valuation', description: 'Discount future cash flows to present value to estimate intrinsic business worth.', steps: ['Project free cash flows (5–10 years)', 'Determine terminal value', 'Select appropriate discount rate (WACC)', 'Calculate present value of cash flows', 'Sum to enterprise value', 'Derive equity value and sensitivity analysis'] },
    ],

    sales: [
      { name: 'MEDDICC', description: 'Qualify complex B2B sales opportunities by assessing six critical elements.', steps: ['Metrics — What quantifiable impact will this have?', 'Economic Buyer — Who controls the budget?', 'Decision Criteria — How will they evaluate options?', 'Decision Process — What are the steps and timeline?', 'Identify Pain — What problem must they solve?', 'Champion — Who is advocating for us internally?', 'Competition — Who are we competing against?'] },
      { name: 'SPIN Selling', description: 'Use structured questioning to uncover needs and build value in large sales.', steps: ['Situation Questions — Understand the context', 'Problem Questions — Identify difficulties', 'Implication Questions — Explore consequences of the problem', 'Need-payoff Questions — Get the buyer to articulate value'] },
      { name: 'Sales Velocity Equation', description: 'Diagnose pipeline performance through four multiplicative levers.', steps: ['Number of Opportunities', 'Average Deal Value', 'Win Rate', 'Length of Sales Cycle', 'Calculate: Velocity = (Opps × Deal Value × Win Rate) ÷ Cycle Length', 'Identify which lever has highest improvement ROI'] },
      { name: 'Challenger Sale', description: 'Teach the customer something new about their business to reframe their thinking.', steps: ['Warm Up — Build credibility', 'Reframe — Challenge their current thinking', 'Rational Drowning — Use data to show the cost of inaction', 'Emotional Impact — Make it personal', 'A New Way — Present your unique solution', 'Your Solution — Connect to your capabilities'] },
    ],

    marketing: [
      { name: 'Marketing Funnel', description: 'Track prospects through awareness, consideration, conversion, and advocacy stages.', steps: ['Awareness — Reach and impressions', 'Interest — Engagement and content consumption', 'Consideration — Leads and marketing qualified leads', 'Conversion — Sales qualified leads and customers', 'Retention — Repeat purchase and loyalty', 'Advocacy — Referrals and NPS'] },
      { name: 'AIDA Model', description: 'Classic framework for structuring marketing communications: Attention, Interest, Desire, Action.', steps: ['Attention — Hook the audience', 'Interest — Engage with relevant messaging', 'Desire — Build emotional connection and urgency', 'Action — Clear call-to-action and frictionless conversion'] },
      { name: 'Content Marketing Matrix', description: 'Plan content by matching audience needs to business goals across four quadrants.', steps: ['Entertain — Broad awareness content', 'Inspire — Emotional, shareable stories', 'Educate — Deep, trust-building expertise', 'Convince — Conversion-focused proof and case studies', 'Map each piece to funnel stage and distribution channel'] },
      { name: 'Attribution Modelling', description: 'Assign credit to marketing touchpoints along the customer journey to optimise spend.', steps: ['Map the customer touchpoint journey', 'Choose attribution model (first-touch, last-touch, linear, time-decay, data-driven)', 'Apply model and allocate credit', 'Analyse channel and campaign ROI', 'Reallocate budget to highest-performing touchpoints'] },
    ],

    customer_success: [
      { name: 'Customer Health Scoring', description: 'Quantify customer health using usage, engagement, support, and sentiment signals.', steps: ['Define health dimensions — adoption, engagement, support, satisfaction, financial', 'Assign weights and scoring logic', 'Collect and normalise data inputs', 'Calculate aggregate health score', 'Segment into health tiers (green/yellow/red)', 'Trigger playbooks for at-risk accounts'] },
      { name: 'Customer Journey Mapping', description: 'Visualise the end-to-end customer experience to identify pain points and opportunities.', steps: ['Define customer personas', 'Map each stage — onboarding, adoption, value realisation, expansion, renewal', 'Identify touchpoints at each stage', 'Capture emotions, pain points, and moments of truth', 'Prioritise improvements', 'Implement and measure impact'] },
      { name: 'Churn Analysis Framework', description: 'Systematically identify and address the root causes of customer churn.', steps: ['Quantify churn rate and revenue churn', 'Segment churn by cohort, size, industry, and tenure', 'Analyse exit interviews and feedback', 'Identify common patterns and root causes', 'Design retention interventions', 'Measure intervention effectiveness'] },
      { name: 'QBR (Quarterly Business Review)', description: 'Structured periodic review to demonstrate value, align on goals, and drive expansion.', steps: ['Review goals and metrics from last quarter', 'Demonstrate value delivered with data', 'Assess current health and adoption', 'Align on goals for next quarter', 'Identify expansion opportunities', 'Document action items and owners'] },
    ],

    product: [
      { name: 'Jobs-to-be-Done', description: 'Understand the progress customers want to make in their lives, not just features they want.', steps: ['Define the job statement — When I ___, I want to ___, so I can ___', 'Identify functional, emotional, and social job dimensions', 'Map current solutions and their shortcomings', 'Uncover unmet needs and overserved areas', 'Design for the job, not the demographic'] },
      { name: 'RICE Prioritisation', description: 'Score features by Reach, Impact, Confidence, and Effort to prioritise the product roadmap.', steps: ['Reach — How many users will this affect?', 'Impact — How much will it affect them? (3=massive, 2=high, 1=medium, 0.5=low)', 'Confidence — How sure are we of the estimates? (%)', 'Effort — How many person-months?', 'Calculate: RICE = (Reach × Impact × Confidence) ÷ Effort', 'Rank and prioritise'] },
      { name: 'Product-Market Fit Survey', description: 'Measure product-market fit by asking how disappointed users would be without your product.', steps: ['Ask: "How would you feel if you could no longer use [product]?"', 'Measure % responding "very disappointed"', 'If >40% — you have product-market fit', 'Analyse responses by segment', 'Double down on the "very disappointed" segment', 'Iterate until you cross the 40% threshold'] },
      { name: 'Opportunity Solution Tree', description: 'Visual map connecting desired outcomes to opportunities, solutions, and experiments.', steps: ['Define the desired outcome (north star metric)', 'Discover opportunities (problems/needs)', 'Generate solutions for each opportunity', 'Design experiments to validate solutions', 'Map and prioritise the tree', 'Run experiments and learn'] },
    ],

    people: [
      { name: 'Employee Lifecycle Framework', description: 'Optimise the employee experience across all stages from attraction to exit.', steps: ['Attract — Employer brand and candidate experience', 'Hire — Selection process and onboarding', 'Develop — Training, coaching, and career paths', 'Engage — Recognition, culture, and wellbeing', 'Retain — Compensation, growth, and satisfaction', 'Exit — Offboarding and alumni network'] },
      { name: 'Performance Management Cycle', description: 'Continuous performance management through goal-setting, feedback, and development.', steps: ['Goal Setting — Align individual and company OKRs', 'Ongoing Feedback — Regular 1:1s and check-ins', 'Mid-cycle Review — Progress and course correction', 'End-of-cycle Review — Assess and calibrate', 'Development Planning — Growth and skill gaps', 'Recognition and Rewards'] },
      { name: 'Talent Pipeline Framework', description: 'Build a pipeline of internal talent ready to fill critical roles.', steps: ['Identify critical roles', 'Assess current bench strength', 'Define competencies for each role', 'Map high-potential employees', 'Create development plans', 'Monitor readiness and succession timelines'] },
      { name: 'Compensation Benchmarking', description: 'Ensure competitive and fair compensation by benchmarking against market data.', steps: ['Define job families and levels', 'Select benchmark sources (Radford, Mercer, etc.)', 'Match roles to benchmark data', 'Analyse market position (percentile)', 'Review internal equity', 'Adjust and communicate'] },
    ],

    legal_risk: [
      { name: 'Risk Matrix', description: 'Assess risks by likelihood and impact to prioritise mitigation efforts.', steps: ['Identify risks across categories — legal, financial, operational, reputational', 'Assess likelihood (rare → almost certain)', 'Assess impact (insignificant → catastrophic)', 'Plot on likelihood-impact matrix', 'Prioritise high-likelihood/high-impact risks', 'Define mitigation and monitoring plans'] },
      { name: 'Contract Review Checklist', description: 'Systematic review of commercial contracts to protect the organisation\'s interests.', steps: ['Parties and definitions', 'Scope of work and deliverables', 'Payment terms and financial obligations', 'Liability, indemnification, and caps', 'Termination and exit provisions', 'Intellectual property rights', 'Data protection and confidentiality', 'Governing law and dispute resolution'] },
      { name: 'Compliance Framework', description: 'Structured approach to meeting regulatory requirements across jurisdictions.', steps: ['Identify applicable regulations (GDPR, SOC2, ISO, industry-specific)', 'Assess current compliance posture', 'Map controls to requirements', 'Identify gaps and remediation plan', 'Implement controls and policies', 'Monitor, audit, and continuously improve'] },
      { name: 'GDPR Data Mapping', description: 'Document how personal data flows through the organisation to ensure privacy compliance.', steps: ['Identify data categories and sources', 'Map data flows and processing activities', 'Define lawful basis for processing', 'Document retention and deletion schedules', 'Assess cross-border transfer mechanisms', 'Maintain records of processing activities (ROPA)'] },
    ],

    analytics: [
      { name: 'KPI Tree / Driver Tree', description: 'Decompose a top-level metric into its operational drivers for root-cause analysis.', steps: ['Define the north star metric', 'Decompose into level-2 drivers', 'Continue decomposition until actionable metrics', 'Assign ownership to each metric', 'Set targets and thresholds', 'Monitor and diagnose deviations'] },
      { name: 'Cohort Analysis', description: 'Group users by a shared characteristic (e.g. signup month) and track behaviour over time.', steps: ['Define cohort characteristic (signup date, acquisition channel, etc.)', 'Group users into cohorts', 'Select behaviour metric to track (retention, revenue, engagement)', 'Analyse trends across cohorts', 'Identify what differentiates high-performing cohorts', 'Apply learnings to acquisition and product'] },
      { name: 'A/B Testing Framework', description: 'Run controlled experiments to make data-driven product and marketing decisions.', steps: ['Define hypothesis and success metric', 'Determine sample size and test duration', 'Randomly assign control and treatment', 'Run the experiment', 'Analyse statistical significance', 'Document learnings and implement winners'] },
      { name: 'Root Cause Analysis (5 Whys)', description: 'Iteratively ask "why" to drill down from symptoms to underlying root causes.', steps: ['Define the problem clearly', 'Ask "Why did this happen?"', 'Ask "Why?" again for each answer', 'Repeat until root cause is identified (typically 5 iterations)', 'Validate the root cause', 'Design and implement corrective action'] },
    ],

    technology: [
      { name: 'Architecture Decision Records (ADR)', description: 'Document significant architecture decisions with context, consequences, and status.', steps: ['Title and context — What is the decision?', 'Decision — What are we doing?', 'Consequences — What are the trade-offs?', 'Status — Proposed, accepted, deprecated, superseded', 'Alternatives considered — What else was evaluated?', 'Date and deciders'] },
      { name: 'Technical Debt Assessment', description: 'Quantify and prioritise technical debt to balance feature delivery with system health.', steps: ['Catalog known technical debt items', 'Assess impact on velocity, reliability, and security', 'Estimate remediation cost for each item', 'Calculate debt-to-value ratio', 'Prioritise high-impact, low-cost items', 'Schedule remediation sprints'] },
      { name: 'DevOps DORA Metrics', description: 'Measure software delivery performance with four key metrics.', steps: ['Deployment Frequency — How often do we deploy?', 'Lead Time for Changes — How long from commit to production?', 'Change Failure Rate — What % of changes cause incidents?', 'Time to Recovery — How fast can we recover from failure?', 'Benchmark against industry standards (elite/high/medium/low)', 'Identify bottlenecks and improvement areas'] },
      { name: 'Threat Modelling (STRIDE)', description: 'Identify security threats by categorising them into six STRIDE categories.', steps: ['Spoofing — Can someone pretend to be someone else?', 'Tampering — Can data or code be modified?', 'Repudiation — Can actions be denied?', 'Information Disclosure — Is sensitive data exposed?', 'Denial of Service — Can the system be made unavailable?', 'Elevation of Privilege — Can someone gain unauthorised access?'] },
    ],

    admin: [
      { name: 'Time Management Matrix (Eisenhower)', description: 'Prioritise tasks by urgency and importance to focus on what truly matters.', steps: ['Quadrant 1 — Urgent and Important: Do immediately', 'Quadrant 2 — Important, Not Urgent: Schedule and protect', 'Quadrant 3 — Urgent, Not Important: Delegate', 'Quadrant 4 — Neither Urgent nor Important: Eliminate', 'Categorise all tasks', 'Spend more time in Quadrant 2'] },
      { name: 'Inbox Zero', description: 'Process emails systematically to maintain a clear inbox and responsive communication.', steps: ['Delete or archive irrelevant messages', 'Delegate what others can handle', 'Respond immediately if <2 minutes', 'Defer to a task list with a scheduled time', 'Do — handle the task now if urgent and important', 'Review and process at set times daily'] },
      { name: 'Meeting Effectiveness Framework', description: 'Ensure every meeting has a clear purpose, agenda, and outcomes.', steps: ['Define the meeting purpose and desired outcome', 'Create and share an agenda in advance', 'Invite only essential participants', 'Start and end on time', 'Document decisions and action items', 'Follow up on action items'] },
    ],
  };

  /**
   * Get all frameworks for a business function.
   * Returns an empty array if the function is not found (defensive).
   */
  async getFrameworks(functionArea: BusinessFunction): Promise<BusinessFramework[]> {
    const frameworks = this.FRAMEWORKS[functionArea];
    if (!frameworks || frameworks.length === 0) {
      this.logger.warn(`[FrameworkEngine] No frameworks found for function: ${functionArea}`);
      return [];
    }
    return [...frameworks]; // Return a copy to prevent mutation
  }

  /**
   * Get the most relevant framework for a specific query.
   * Uses keyword matching between framework name/steps and the query to select
   * the best fit. Falls back to the first framework if no strong match.
   */
  async selectFramework(
    functionArea: BusinessFunction,
    query: string,
  ): Promise<BusinessFramework | null> {
    const frameworks = this.FRAMEWORKS[functionArea];
    if (!frameworks || frameworks.length === 0) {
      this.logger.warn(
        `[FrameworkEngine] Cannot select framework for ${functionArea}: none defined`,
      );
      return null;
    }

    const lowerQuery = query.toLowerCase();
    let bestFramework = frameworks[0];
    let bestScore = 0;

    for (const fw of frameworks) {
      const score = this.scoreFrameworkRelevance(fw, lowerQuery);
      if (score > bestScore) {
        bestScore = score;
        bestFramework = fw;
      }
    }

    this.logger.log(
      `[FrameworkEngine] Selected "${bestFramework.name}" for ${functionArea} ` +
      `(relevance score: ${bestScore})`,
    );

    return bestFramework;
  }

  /**
   * Build a structured reasoning prompt using the selected framework.
   * The prompt instructs the AI to work through each framework step systematically.
   */
  async buildReasoningPrompt(
    framework: BusinessFramework,
    context: string,
  ): Promise<string> {
    const stepsBlock = framework.steps
      .map((step, i) => `${i + 1}. **${step}**: [your analysis here]`)
      .join('\n');

    return (
      `Apply the **${framework.name}** framework to analyse this situation.\n\n` +
      `**Context:** ${context}\n\n` +
      `**Framework:** ${framework.description}\n\n` +
      `Work through each step systematically:\n${stepsBlock}\n\n` +
      `After completing all steps, synthesise your analysis into a clear recommendation ` +
      `with supporting rationale and any trade-offs or risks to consider.`
    );
  }

  /**
   * Get a quick-reference summary of all frameworks for a function.
   * Useful for UIs that show available frameworks to the user.
   */
  async getFrameworkSummary(functionArea: BusinessFunction): Promise<Array<{ name: string; description: string; stepCount: number }>> {
    const frameworks = await this.getFrameworks(functionArea);
    return frameworks.map(fw => ({
      name: fw.name,
      description: fw.description,
      stepCount: fw.steps.length,
    }));
  }

  /**
   * Select and build a reasoning prompt in one call — convenience method.
   */
  async selectAndBuildPrompt(
    functionArea: BusinessFunction,
    query: string,
    context: string,
  ): Promise<{ framework: BusinessFramework; prompt: string } | null> {
    const framework = await this.selectFramework(functionArea, query);
    if (!framework) return null;

    const prompt = await this.buildReasoningPrompt(framework, context);
    return { framework, prompt };
  }

  // ==========================================================================
  // Private helpers
  // ==========================================================================

  /**
   * Score how relevant a framework is to a query by counting keyword overlaps.
   * Matches in the framework name get extra weight (3x).
   * Multi-word phrase matches in steps get double weight.
   */
  private scoreFrameworkRelevance(framework: BusinessFramework, query: string): number {
    let score = 0;

    // Name matches are highly indicative — weight them strongly
    const nameWords = framework.name.toLowerCase().split(/\s+/);
    for (const word of nameWords) {
      if (word.length > 2 && query.includes(word)) {
        score += 3;
      }
    }

    // Description matches
    const descWords = framework.description.toLowerCase().split(/[\s,;.-]+/);
    for (const word of descWords) {
      if (word.length > 3 && query.includes(word)) {
        score += 1;
      }
    }

    // Step name matches — can indicate deep relevance
    for (const step of framework.steps) {
      const stepLower = step.toLowerCase();
      if (query.includes(stepLower)) {
        // Full step name match is very strong signal
        score += 2;
      } else {
        // Partial word matches within steps
        const stepWords = stepLower.split(/[\s,;.-]+/);
        for (const word of stepWords) {
          if (word.length > 3 && query.includes(word)) {
            score += 0.5;
          }
        }
      }
    }

    return score;
  }
}
