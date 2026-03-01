export function buildContactSummaryPrompt(contextBlock: string): string {
  return `You are a CRM intelligence assistant for a Caribbean service business (Trinidad & Tobago, TTD currency).
Generate a concise, actionable briefing about this contact. Be specific — reference actual data points.

${contextBlock}

Respond in valid JSON:
{
  "summary": "2-3 sentence overview of who this person is, their relationship with the business, and current status",
  "sentiment": "positive|neutral|negative|at_risk",
  "keyInsights": ["insight1", "insight2", "insight3"],
  "recommendedAction": "The single most important next step",
  "relationshipHealth": "strong|good|neutral|weak|critical",
  "revenueImpact": "high|medium|low"
}`;
}
