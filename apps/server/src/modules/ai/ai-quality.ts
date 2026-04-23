export type OutputCategory =
  | 'documents'
  | 'messages'
  | 'reports'
  | 'briefings'
  | 'marketing'
  | 'general';

export interface ResolvedTemplate {
  tone: string;
  formality: string;
  targetLength: string;
  requiredSections: string[];
  customInstructions: string | null;
  category: OutputCategory;
}

export const SYSTEM_DEFAULT_TEMPLATES: Record<OutputCategory, ResolvedTemplate> = {
  documents: {
    category: 'documents',
    tone: 'professional',
    formality: 'high',
    targetLength: 'comprehensive',
    requiredSections: [],
    customInstructions: null,
  },
  messages: {
    category: 'messages',
    tone: 'friendly',
    formality: 'medium',
    targetLength: 'brief',
    requiredSections: [],
    customInstructions: null,
  },
  reports: {
    category: 'reports',
    tone: 'professional',
    formality: 'high',
    targetLength: 'comprehensive',
    requiredSections: ['Executive Summary', 'Key Findings', 'Recommendations'],
    customInstructions: null,
  },
  briefings: {
    category: 'briefings',
    tone: 'professional',
    formality: 'medium',
    targetLength: 'medium',
    requiredSections: ['Summary', 'Priorities', 'Action Items'],
    customInstructions: null,
  },
  marketing: {
    category: 'marketing',
    tone: 'friendly',
    formality: 'low',
    targetLength: 'medium',
    requiredSections: [],
    customInstructions: null,
  },
  general: {
    category: 'general',
    tone: 'professional',
    formality: 'medium',
    targetLength: 'medium',
    requiredSections: [],
    customInstructions: null,
  },
};

const LENGTH_GUIDANCE: Record<string, string> = {
  brief: 'Keep responses concise — 1-3 paragraphs or equivalent. Be direct and to the point.',
  medium: 'Provide moderate detail — 3-6 paragraphs or equivalent. Balance thoroughness with readability.',
  comprehensive: 'Be thorough and complete — cover all relevant aspects in depth. Prioritize completeness.',
};

const FORMALITY_GUIDANCE: Record<string, string> = {
  high: 'Use formal language, complete sentences, no contractions, and precise professional terminology.',
  medium: 'Use professional but accessible language. Contractions are acceptable. Avoid slang.',
  low: 'Use conversational, approachable language. Warm and natural — Caribbean-friendly where appropriate.',
};

const TONE_GUIDANCE: Record<string, string> = {
  formal: 'Adopt a strictly formal, authoritative tone appropriate for legal or regulatory contexts.',
  professional: 'Maintain a professional, confident, and trustworthy tone.',
  friendly: 'Adopt a warm, personable tone that builds rapport while remaining credible.',
  'caribbean-casual': 'Use warm, natural Caribbean-English communication style — culturally authentic, not generic.',
};

export const UNIVERSAL_QUALITY_DIRECTIVES = `
UNIVERSAL QUALITY STANDARDS (non-negotiable):
1. EVIDENCE-BASED: Every recommendation, insight, or claim must be grounded in the actual data provided. No generic advice that could apply to any business.
2. SPECIFIC: Reference actual numbers, names, dates, and business-specific details from the context. Avoid vague generalizations.
3. NO PLACEHOLDER TEXT: Never output text like "[insert here]", "N/A", "TBD", or "(fill in later)". If data is missing, make a reasonable inference and state the assumption.
4. ACTIONABLE: Each piece of guidance should be immediately actionable. State WHO does WHAT by WHEN.
5. PROFESSIONAL: Output must be presentable to clients, partners, or stakeholders without further editing.
6. STRUCTURALLY SOUND: Use clear section breaks, consistent formatting, and logical flow.
7. NO FILLER CONTENT: Do not pad responses with obvious statements, generic disclaimers, or boilerplate that adds no value.
`.trim();

export function buildQualityDirectiveSuffix(template: ResolvedTemplate): string {
  const parts: string[] = [];

  parts.push(UNIVERSAL_QUALITY_DIRECTIVES);
  parts.push('');
  parts.push('OUTPUT FORMAT PREFERENCES:');
  parts.push(`- Tone: ${TONE_GUIDANCE[template.tone] || TONE_GUIDANCE.professional}`);
  parts.push(`- Formality: ${FORMALITY_GUIDANCE[template.formality] || FORMALITY_GUIDANCE.medium}`);
  parts.push(`- Length: ${LENGTH_GUIDANCE[template.targetLength] || LENGTH_GUIDANCE.medium}`);

  if (template.requiredSections.length > 0) {
    parts.push(`- Required Sections (include ALL of these in order): ${template.requiredSections.join(', ')}`);
  }

  if (template.customInstructions) {
    parts.push('');
    parts.push('ADDITIONAL BUSINESS INSTRUCTIONS:');
    parts.push(template.customInstructions);
  }

  return parts.join('\n');
}

export function injectQualityDirectives(
  systemPrompt: string,
  template: ResolvedTemplate,
): string {
  const suffix = buildQualityDirectiveSuffix(template);
  return `${systemPrompt}\n\n${suffix}`;
}

/**
 * Specificity heuristics by category — detects outputs that are too vague or generic.
 * Returns a list of specificity-failure reasons, or empty array if output is specific enough.
 */
function checkSpecificity(content: string, category: OutputCategory): string[] {
  const issues: string[] = [];
  const lower = content.toLowerCase();

  const genericPhrases: string[] = [
    'in today\'s competitive market',
    'in the fast-paced world',
    'it is important to',
    'needless to say',
    'as mentioned above',
    'going forward',
    'at the end of the day',
    'moving forward',
    'in conclusion, it is clear that',
    'overall, it can be said',
  ];

  let genericCount = 0;
  for (const phrase of genericPhrases) {
    if (lower.includes(phrase)) genericCount++;
  }

  if (genericCount >= 3) {
    issues.push(`Response uses ${genericCount} generic filler phrases — output lacks specificity`);
  }

  if (category === 'reports' || category === 'briefings') {
    const hasNumbers = /\d+(\.\d+)?(%|\s*(TTD|USD|\$|clients?|customers?|sales?|orders?|sessions?|conversions?))/.test(content);
    if (!hasNumbers) {
      issues.push('Reports/briefings must reference concrete numbers or metrics — none found');
    }
  }

  return issues;
}

/**
 * Validates AI output against quality requirements.
 * Checks minimum length, placeholder text, AI refusals, required section presence,
 * and specificity heuristics per category.
 */
export function validateAiOutput(
  content: string,
  category: OutputCategory,
  requiredSections: string[] = [],
): {
  passed: boolean;
  issues: string[];
} {
  const issues: string[] = [];

  if (!content || content.trim().length === 0) {
    return { passed: false, issues: ['Empty response received'] };
  }

  const minLengths: Record<OutputCategory, number> = {
    documents: 500,
    reports: 300,
    briefings: 200,
    marketing: 100,
    messages: 50,
    general: 100,
  };

  const minLen = minLengths[category] || 100;
  if (content.length < minLen) {
    issues.push(`Response too short (${content.length} chars, minimum ${minLen} for ${category})`);
  }

  const placeholderPatterns = [
    /\[insert\s/i,
    /\[fill\s/i,
    /\[add\s/i,
    /\[your\s/i,
    /\[company\sname\]/i,
    /\[date\]/i,
    /\[tbd\]/i,
    /\[placeholder\]/i,
  ];

  for (const pattern of placeholderPatterns) {
    if (pattern.test(content)) {
      issues.push('Response contains placeholder text that was not replaced');
      break;
    }
  }

  const genericPhrases = [
    /^i (cannot|can't|am unable to)/i,
    /as an ai language model/i,
    /i don't have access to real-time/i,
  ];

  for (const pattern of genericPhrases) {
    if (pattern.test(content.substring(0, 200))) {
      issues.push('Response contains AI refusal or generic AI disclaimer language');
      break;
    }
  }

  if (requiredSections.length > 0) {
    const contentLower = content.toLowerCase();
    const missingSections: string[] = [];
    for (const section of requiredSections) {
      const sectionLower = section.toLowerCase();
      if (!contentLower.includes(sectionLower)) {
        missingSections.push(section);
      }
    }
    if (missingSections.length > 0) {
      issues.push(`Missing required sections: ${missingSections.join(', ')}`);
    }
  }

  const specificityIssues = checkSpecificity(content, category);
  issues.push(...specificityIssues);

  return {
    passed: issues.length === 0,
    issues,
  };
}
